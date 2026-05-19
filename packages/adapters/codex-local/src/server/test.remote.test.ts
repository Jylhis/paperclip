import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";

const {
  ensureAdapterExecutionTargetDirectory,
  ensureAdapterExecutionTargetCommandResolvable,
  maybeRunSandboxInstallCommand,
  runAdapterExecutionTargetProcess,
  describeAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
} = vi.hoisted(() => {
  return {
    ensureAdapterExecutionTargetDirectory: vi.fn(async () => {}),
    ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => {}),
    maybeRunSandboxInstallCommand: vi.fn(async () => null),
    runAdapterExecutionTargetProcess: vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: [
        "{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}",
        "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"hello\"}}",
        "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"cached_input_tokens\":0,\"output_tokens\":1}}",
      ].join("\n"),
      stderr: "",
      pid: 123,
      startedAt: new Date().toISOString(),
    })),
    describeAdapterExecutionTarget: vi.fn(() => "QA SSH"),
    resolveAdapterExecutionTargetCwd: vi.fn((target, configuredCwd, fallbackCwd) => {
      if (typeof configuredCwd === "string" && configuredCwd.trim().length > 0) return configuredCwd;
      if (target && typeof target === "object" && "remoteCwd" in target && typeof target.remoteCwd === "string") {
        return target.remoteCwd;
      }
      return fallbackCwd;
    }),
  };
});

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return {
    ...actual,
    ensureAdapterExecutionTargetDirectory,
    ensureAdapterExecutionTargetCommandResolvable,
    maybeRunSandboxInstallCommand,
    runAdapterExecutionTargetProcess,
    describeAdapterExecutionTarget,
    resolveAdapterExecutionTargetCwd,
  };
});

import { testEnvironment } from "./test.js";

describe("codex remote environment diagnostics", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it("does not stage managed CODEX_HOME for remote hello probes without an API key", async () => {
    const remoteTarget: AdapterExecutionTarget = {
      kind: "remote",
      transport: "ssh",
      remoteCwd: "/remote/workspace",
      spec: {
        host: "127.0.0.1",
        port: 22,
        username: "agent",
        privateKey: "PRIVATE KEY",
        knownHosts: "KNOWN HOSTS",
        remoteCwd: "/remote/workspace",
        remoteWorkspacePath: "/remote/workspace",
        strictHostKeyChecking: false,
      },
    };

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        command: "codex",
      },
      executionTarget: remoteTarget,
      environmentName: "QA SSH",
    });

    expect(result.status).toBe("pass");
    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(1);
    const probeCall = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as
      | [string, { kind: string; remoteCwd: string }, string, string[], { cwd: string; env: Record<string, string> }]
      | undefined;
    expect(probeCall?.[1]).toMatchObject({
      kind: "remote",
      remoteCwd: "/remote/workspace",
    });
    expect(probeCall?.[4]).toMatchObject({
      cwd: "/remote/workspace",
      env: expect.not.objectContaining({
        CODEX_HOME: expect.any(String),
      }),
    });
  });

  it("avoids /tmp CODEX_HOME for remote API-key hello probes", async () => {
    const remoteTarget: AdapterExecutionTarget = {
      kind: "remote",
      transport: "sandbox",
      providerKey: "cloudflare",
      remoteCwd: "/remote/workspace",
      runner: {
        execute: async () => ({
          exitCode: 0,
          signal: null,
          timedOut: false,
          stdout: "",
          stderr: "",
          pid: null,
          startedAt: new Date().toISOString(),
        }),
      },
    };

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        command: "codex",
        env: {
          OPENAI_API_KEY: "sk-test",
        },
      },
      executionTarget: remoteTarget,
      environmentName: "QA Cloudflare",
    });

    expect(result.status).toBe("pass");
    const probeCall = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as
      | [string, AdapterExecutionTarget, string, string[], { cwd: string; env: Record<string, string> }]
      | undefined;
    expect(probeCall?.[4].env.CODEX_HOME).toContain("/remote/workspace/.paperclip-runtime/codex/probe-home-codex-envtest-");
    expect(probeCall?.[4].env.CODEX_HOME?.startsWith("/tmp/")).toBe(false);
    expect(probeCall?.[3]).toContain("--skip-git-repo-check");
  });
});

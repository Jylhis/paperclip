import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";

const {
  ensureAdapterExecutionTargetDirectory,
  ensureAdapterExecutionTargetCommandResolvable,
  maybeRunSandboxInstallCommand,
  runAdapterExecutionTargetProcess,
  describeAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
} = vi.hoisted(() => ({
  ensureAdapterExecutionTargetDirectory: vi.fn(async () => {}),
  ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => {}),
  maybeRunSandboxInstallCommand: vi.fn(async () => null),
  runAdapterExecutionTargetProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: [
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({
        type: "turn_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
        },
      }),
      JSON.stringify({ type: "agent_end", messages: [] }),
    ].join("\n"),
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
  describeAdapterExecutionTarget: vi.fn(() => "QA Cloudflare"),
  resolveAdapterExecutionTargetCwd: vi.fn((target, configuredCwd, fallbackCwd) => {
    if (typeof configuredCwd === "string" && configuredCwd.trim().length > 0) return configuredCwd;
    if (target && typeof target === "object" && "remoteCwd" in target && typeof target.remoteCwd === "string") {
      return target.remoteCwd;
    }
    return fallbackCwd;
  }),
}));

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

const remoteTarget = (): AdapterExecutionTarget => ({
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
});

describe("pi remote environment diagnostics", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not forward host process.env to remote probe env", async () => {
    const SENTINEL = "__PAPERCLIP_TEST_PI_HOST_SECRET__";
    process.env[SENTINEL] = "should-not-leak";
    try {
      await testEnvironment({
        companyId: "company-1",
        adapterType: "pi_local",
        config: { command: "pi", model: "openai/gpt-4o" },
        executionTarget: remoteTarget(),
        environmentName: "QA Cloudflare",
      });

      const probeCall = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as
        | [string, AdapterExecutionTarget, string, string[], { cwd: string; env: Record<string, string> }]
        | undefined;
      expect(probeCall?.[4].env).not.toHaveProperty(SENTINEL);

      const cmdCheckCall = ensureAdapterExecutionTargetCommandResolvable.mock.calls[0] as unknown as
        | [string, AdapterExecutionTarget, string, Record<string, string>]
        | undefined;
      expect(cmdCheckCall?.[3]).not.toHaveProperty(SENTINEL);
    } finally {
      delete process.env[SENTINEL];
    }
  });

  it("includes host process.env in local probe env", async () => {
    const SENTINEL = "__PAPERCLIP_TEST_PI_HOST_LOCAL__";
    process.env[SENTINEL] = "should-be-present";
    try {
      await testEnvironment({
        companyId: "company-1",
        adapterType: "pi_local",
        config: { command: "pi", model: "openai/gpt-4o" },
        executionTarget: undefined,
        environmentName: undefined,
      });

      const cmdCheckCall = ensureAdapterExecutionTargetCommandResolvable.mock.calls[0] as unknown as
        | [string, AdapterExecutionTarget | null, string, Record<string, string>]
        | undefined;
      expect(cmdCheckCall?.[3]).toHaveProperty(SENTINEL, "should-be-present");
    } finally {
      delete process.env[SENTINEL];
    }
  });
});

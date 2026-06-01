import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { runChildProcess, ensureCommandResolvable, resolveCommandForLogs } = vi.hoisted(() => ({
  runChildProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "/usr/bin/codex"),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureCommandResolvable,
    resolveCommandForLogs,
    runChildProcess,
  };
});

import { execute } from "./execute.js";
import { runCodexLogin } from "./execute.js";

describe("codex auth-required detection during execute", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("surfaces codex_auth_required with the login URL when Codex reports it is not logged in", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-codex-auth-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHomeDir = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHomeDir, { recursive: true });

    runChildProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "Open https://auth.openai.com/authorize?code=abc123 to sign in.\n",
      stderr: "Error: not logged in. Please run `codex login`.\n",
      pid: 321,
      startedAt: new Date().toISOString(),
    });

    const result = await execute({
      runId: "run-auth",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: "codex", env: { CODEX_HOME: codexHomeDir } },
      context: {
        paperclipWorkspace: { cwd: workspaceDir, source: "project_primary" },
      },
      onLog: async () => {},
    });

    expect(result.errorCode).toBe("codex_auth_required");
    expect(result.errorMeta?.loginUrl).toBe("https://auth.openai.com/authorize?code=abc123");
  });
});

describe("runCodexLogin", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("runs `codex login`, returns process output, and extracts the login URL", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-codex-login-"));
    cleanupDirs.push(rootDir);
    const codexHomeDir = path.join(rootDir, "codex-home");
    await mkdir(codexHomeDir, { recursive: true });

    runChildProcess.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "Starting local login server.\nOpen https://auth.openai.com/authorize?code=xyz789 to continue.\n",
      stderr: "",
      pid: 555,
      startedAt: new Date().toISOString(),
    });

    const result = await runCodexLogin({
      runId: "login-run",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      config: { command: "codex", env: { CODEX_HOME: codexHomeDir } },
    });

    expect(runChildProcess).toHaveBeenCalledTimes(1);
    const call = runChildProcess.mock.calls[0] as unknown as [string, string, string[], unknown];
    expect(call[2]).toEqual(["login"]);
    expect(result.exitCode).toBe(0);
    expect(result.loginUrl).toBe("https://auth.openai.com/authorize?code=xyz789");
    expect(result.stdout).toContain("Starting local login server.");
  });
});

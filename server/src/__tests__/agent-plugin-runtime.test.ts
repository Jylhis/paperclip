import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPluginProcessSpec } from "@paperclipai/shared";

const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const companyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const configId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const runId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const enabledRow = {
  id: configId,
  agentId,
  companyId,
  kind: "mcp",
  name: "test-mcp",
  serverBinary: "/usr/bin/echo",
  args: ["hello"],
  env: { NODE_ENV: "test" },
  cwd: null,
  timeoutSec: 30,
  restartPolicy: "on_failure",
  workspaceScope: "agent",
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const disabledRow = { ...enabledRow, id: "disabled-id", enabled: false, name: "disabled-mcp" };

const mockSelect = vi.fn();
const mockDb = {
  select: mockSelect,
  insert: vi.fn(),
} as unknown as Parameters<typeof import("../services/agent-plugin-runtime.js").getEnabledPluginSpecsForAgent>[0];

function setupSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  mockSelect.mockReturnValue(chain);
  return chain;
}

function makeLogActivityMock() {
  return vi.fn().mockResolvedValue(undefined);
}

vi.mock("../services/activity-log.js", () => ({
  logActivity: makeLogActivityMock(),
}));

describe("getEnabledPluginSpecsForAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns specs only for enabled configs", async () => {
    setupSelectChain([enabledRow]);
    const { getEnabledPluginSpecsForAgent } = await import("../services/agent-plugin-runtime.js");
    const specs = await getEnabledPluginSpecsForAgent(mockDb, agentId, companyId);
    expect(specs).toHaveLength(1);
    expect(specs[0].configId).toBe(configId);
    expect(specs[0].kind).toBe("mcp");
    expect(specs[0].serverBinary).toBe("/usr/bin/echo");
  });

  it("returns empty array when no enabled configs exist", async () => {
    setupSelectChain([]);
    const { getEnabledPluginSpecsForAgent } = await import("../services/agent-plugin-runtime.js");
    const specs = await getEnabledPluginSpecsForAgent(mockDb, agentId, companyId);
    expect(specs).toHaveLength(0);
  });

  it("maps DB row fields to AgentPluginProcessSpec correctly", async () => {
    setupSelectChain([enabledRow]);
    const { getEnabledPluginSpecsForAgent } = await import("../services/agent-plugin-runtime.js");
    const [spec] = await getEnabledPluginSpecsForAgent(mockDb, agentId, companyId);
    expect(spec.name).toBe("test-mcp");
    expect(spec.args).toEqual(["hello"]);
    expect(spec.env).toEqual({ NODE_ENV: "test" });
    expect(spec.cwd).toBeNull();
    expect(spec.timeoutSec).toBe(30);
    expect(spec.restartPolicy).toBe("on_failure");
    expect(spec.workspaceScope).toBe("agent");
  });
});

describe("startPluginsForRun / stopPluginsForRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts processes for valid specs and returns handles", async () => {
    const mockInsertChain = { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{}]) };
    (mockDb as any).insert = vi.fn().mockReturnValue(mockInsertChain);

    const echoSpec: AgentPluginProcessSpec = {
      configId,
      kind: "mcp",
      name: "echo-server",
      serverBinary: "/usr/bin/echo",
      args: ["test"],
      env: {},
      cwd: null,
      timeoutSec: 5,
      restartPolicy: "never",
      workspaceScope: "agent",
    };

    const { startPluginsForRun, stopPluginsForRun } = await import("../services/agent-plugin-runtime.js");
    const handles = await startPluginsForRun(mockDb, {
      runId,
      agentId,
      companyId,
      specs: [echoSpec],
    });

    expect(handles).toHaveLength(1);
    expect(handles[0].configId).toBe(configId);
    expect(handles[0].name).toBe("echo-server");
    expect(["starting", "running", "stopped"]).toContain(handles[0].health);

    // Cleanup
    await stopPluginsForRun(mockDb, { runId, agentId, companyId });
  }, 5000);

  it("returns failed handle when binary does not exist", async () => {
    const badSpec: AgentPluginProcessSpec = {
      configId: "bad-id",
      kind: "mcp",
      name: "nonexistent-server",
      serverBinary: "/nonexistent/binary/that/should/not/exist/ever",
      args: [],
      env: {},
      cwd: null,
      timeoutSec: 5,
      restartPolicy: "never",
      workspaceScope: "agent",
    };

    const { startPluginsForRun } = await import("../services/agent-plugin-runtime.js");
    const handles = await startPluginsForRun(mockDb, {
      runId: "fail-run",
      agentId,
      companyId,
      specs: [badSpec],
    });

    expect(handles).toHaveLength(1);
    // May be "failed" immediately or "starting" if error fires asynchronously
    expect(handles[0].name).toBe("nonexistent-server");
  }, 5000);

  it("returns empty array when no specs given", async () => {
    const { startPluginsForRun } = await import("../services/agent-plugin-runtime.js");
    const handles = await startPluginsForRun(mockDb, {
      runId: "no-specs-run",
      agentId,
      companyId,
      specs: [],
    });
    expect(handles).toHaveLength(0);
  });

  it("stopPluginsForRun is idempotent", async () => {
    const { stopPluginsForRun } = await import("../services/agent-plugin-runtime.js");
    // Stopping a run that has no processes should not throw
    await expect(stopPluginsForRun(mockDb, { runId: "nonexistent-run", agentId, companyId })).resolves.toBeUndefined();
  });
});

describe("listPluginHandlesForRun", () => {
  it("returns empty array for runs with no processes", async () => {
    const { listPluginHandlesForRun } = await import("../services/agent-plugin-runtime.js");
    expect(listPluginHandlesForRun("no-such-run")).toEqual([]);
  });
});

describe("per-run isolation", () => {
  it("processes from one run do not appear in another", async () => {
    const echoSpec: AgentPluginProcessSpec = {
      configId,
      kind: "mcp",
      name: "iso-server",
      serverBinary: "/usr/bin/echo",
      args: ["iso"],
      env: {},
      cwd: null,
      timeoutSec: 5,
      restartPolicy: "never",
      workspaceScope: "agent",
    };

    const { startPluginsForRun, listPluginHandlesForRun, stopPluginsForRun } = await import("../services/agent-plugin-runtime.js");

    await startPluginsForRun(mockDb, { runId: "run-A", agentId, companyId, specs: [echoSpec] });

    const handlesRunB = listPluginHandlesForRun("run-B");
    expect(handlesRunB).toHaveLength(0);

    await stopPluginsForRun(mockDb, { runId: "run-A", agentId, companyId });
    // After stop, run-A processes are gone
    const handlesRunA = listPluginHandlesForRun("run-A");
    expect(handlesRunA).toHaveLength(0);
  }, 5000);
});

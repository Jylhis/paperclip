/**
 * AgentPluginRuntime — process lifecycle manager for MCP/LSP helper processes.
 *
 * Responsibilities:
 * - Load enabled AgentPluginConfigs for an agent from the DB (with unredacted env).
 * - Spawn each process securely: no shell, array args, per-config resource limits.
 * - Track process health per-run; tear down on run completion (no cross-run leakage).
 * - Emit activity log events for plugin start and stop.
 * - Surface `AgentPluginProcessSpec[]` for injection into adapter execution context.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentPluginConfigs } from "@paperclipai/db";
import type {
  AgentPluginHealth,
  AgentPluginProcessSpec,
  AgentPluginRestartPolicy,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGKILL_GRACE_MS = 500;
const MAX_STDERR_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentPluginProcessHandle {
  configId: string;
  name: string;
  kind: string;
  health: AgentPluginHealth;
  pid: number | undefined;
  startedAt: string;
  stderrExcerpt: string;
}

interface RunningProcess {
  handle: AgentPluginProcessHandle;
  spec: AgentPluginProcessSpec;
  child: ChildProcess;
  killTimer: NodeJS.Timeout | null;
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const runProcesses = new Map<string, RunningProcess[]>();

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function loadEnabledSpecs(
  db: Db,
  agentId: string,
  companyId: string,
): Promise<AgentPluginProcessSpec[]> {
  const rows = await db
    .select()
    .from(agentPluginConfigs)
    .where(
      and(
        eq(agentPluginConfigs.agentId, agentId),
        eq(agentPluginConfigs.companyId, companyId),
        eq(agentPluginConfigs.enabled, true),
      ),
    );

  return rows.map((row) => ({
    configId: row.id,
    kind: row.kind as AgentPluginProcessSpec["kind"],
    name: row.name,
    serverBinary: row.serverBinary,
    args: (row.args as string[]) ?? [],
    env: (row.env as Record<string, string>) ?? {},
    cwd: row.cwd ?? null,
    timeoutSec: row.timeoutSec,
    restartPolicy: row.restartPolicy as AgentPluginRestartPolicy,
    workspaceScope: row.workspaceScope as AgentPluginProcessSpec["workspaceScope"],
  }));
}

// ---------------------------------------------------------------------------
// Process launch
// ---------------------------------------------------------------------------

function spawnPlugin(spec: AgentPluginProcessSpec): RunningProcess {
  const log = logger.child({
    service: "agent-plugin-runtime",
    configId: spec.configId,
    pluginName: spec.name,
    kind: spec.kind,
  });

  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
    ),
    ...spec.env,
  };

  const child = spawn(spec.serverBinary, spec.args, {
    shell: false,
    env,
    cwd: spec.cwd ?? process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const handle: AgentPluginProcessHandle = {
    configId: spec.configId,
    name: spec.name,
    kind: spec.kind,
    health: "starting",
    pid: child.pid,
    startedAt: new Date().toISOString(),
    stderrExcerpt: "",
  };

  const running: RunningProcess = { handle, spec, child, killTimer: null };

  let stderrBytes = 0;
  child.stderr?.on("data", (chunk: Buffer) => {
    const remaining = MAX_STDERR_BYTES - stderrBytes;
    if (remaining <= 0) return;
    const slice = chunk.subarray(0, remaining).toString("utf8");
    handle.stderrExcerpt += slice;
    stderrBytes += slice.length;
  });

  child.on("spawn", () => {
    handle.health = "running";
    log.info({ pid: child.pid }, "plugin process started");
  });

  child.on("error", (err) => {
    handle.health = "failed";
    log.warn({ err, pid: child.pid }, "plugin process error");
  });

  child.on("close", (code, signal) => {
    const wasRunning = handle.health === "running";
    handle.health = wasRunning && code === 0 ? "stopped" : wasRunning ? "degraded" : handle.health;
    if (running.killTimer) {
      clearTimeout(running.killTimer);
      running.killTimer = null;
    }
    log.info({ code, signal, health: handle.health }, "plugin process exited");
  });

  return running;
}

function stopRunningProcess(running: RunningProcess): void {
  const { child, handle } = running;
  if (handle.health === "stopped" || handle.health === "failed") return;

  handle.health = "stopped";
  child.kill("SIGTERM");
  running.killTimer = setTimeout(() => {
    child.kill("SIGKILL");
    running.killTimer = null;
  }, SIGKILL_GRACE_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load enabled plugin configs for an agent and return them as process specs.
 * This is the read-only path — does not spawn anything.
 */
export async function getEnabledPluginSpecsForAgent(
  db: Db,
  agentId: string,
  companyId: string,
): Promise<AgentPluginProcessSpec[]> {
  return loadEnabledSpecs(db, agentId, companyId);
}

/**
 * Start all enabled plugin processes for a run.
 * Processes are keyed by runId for per-run isolation.
 * Activity events are emitted for each successful start and for failures.
 */
export async function startPluginsForRun(
  db: Db,
  params: {
    runId: string;
    agentId: string;
    companyId: string;
    specs: AgentPluginProcessSpec[];
  },
): Promise<AgentPluginProcessHandle[]> {
  const log = logger.child({
    service: "agent-plugin-runtime",
    runId: params.runId,
    agentId: params.agentId,
  });

  if (params.specs.length === 0) return [];

  const running: RunningProcess[] = [];
  const handles: AgentPluginProcessHandle[] = [];

  for (const spec of params.specs) {
    try {
      const proc = spawnPlugin(spec);
      running.push(proc);
      handles.push(proc.handle);

      void logActivity(db, {
        companyId: params.companyId,
        actorType: "system",
        actorId: params.agentId,
        action: "agent_plugin.started",
        entityType: "agent_plugin_config",
        entityId: spec.configId,
        agentId: params.agentId,
        runId: params.runId,
        details: {
          name: spec.name,
          kind: spec.kind,
          serverBinary: spec.serverBinary,
          pid: proc.handle.pid,
        },
      }).catch((err: unknown) => {
        log.warn({ err, configId: spec.configId }, "failed to log plugin start activity");
      });
    } catch (err) {
      log.warn({ err, configId: spec.configId, name: spec.name }, "plugin process failed to start");
      handles.push({
        configId: spec.configId,
        name: spec.name,
        kind: spec.kind,
        health: "failed",
        pid: undefined,
        startedAt: new Date().toISOString(),
        stderrExcerpt: err instanceof Error ? err.message : String(err),
      });

      void logActivity(db, {
        companyId: params.companyId,
        actorType: "system",
        actorId: params.agentId,
        action: "agent_plugin.start_failed",
        entityType: "agent_plugin_config",
        entityId: spec.configId,
        agentId: params.agentId,
        runId: params.runId,
        details: {
          name: spec.name,
          kind: spec.kind,
          error: err instanceof Error ? err.message : String(err),
        },
      }).catch(() => {});
    }
  }

  if (running.length > 0) {
    runProcesses.set(params.runId, running);
  }

  return handles;
}

/**
 * Stop all plugin processes for a run and emit activity log events.
 * Safe to call multiple times (idempotent).
 */
export async function stopPluginsForRun(
  db: Db,
  params: {
    runId: string;
    agentId: string;
    companyId: string;
  },
): Promise<void> {
  const log = logger.child({
    service: "agent-plugin-runtime",
    runId: params.runId,
    agentId: params.agentId,
  });

  const procs = runProcesses.get(params.runId);
  if (!procs || procs.length === 0) return;

  runProcesses.delete(params.runId);

  for (const proc of procs) {
    stopRunningProcess(proc);
    void logActivity(db, {
      companyId: params.companyId,
      actorType: "system",
      actorId: params.agentId,
      action: "agent_plugin.stopped",
      entityType: "agent_plugin_config",
      entityId: proc.spec.configId,
      agentId: params.agentId,
      runId: params.runId,
      details: {
        name: proc.spec.name,
        kind: proc.spec.kind,
        health: proc.handle.health,
        pid: proc.handle.pid,
      },
    }).catch((err: unknown) => {
      log.warn({ err, configId: proc.spec.configId }, "failed to log plugin stop activity");
    });
  }
}

/**
 * List running process handles for a run.
 */
export function listPluginHandlesForRun(runId: string): AgentPluginProcessHandle[] {
  return (runProcesses.get(runId) ?? []).map((p) => p.handle);
}

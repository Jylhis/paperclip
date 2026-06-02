export const AGENT_PLUGIN_CONFIG_KINDS = ["mcp", "lsp"] as const;
export type AgentPluginConfigKind = (typeof AGENT_PLUGIN_CONFIG_KINDS)[number];

export const AGENT_PLUGIN_RESTART_POLICIES = ["never", "on_failure", "always"] as const;
export type AgentPluginRestartPolicy = (typeof AGENT_PLUGIN_RESTART_POLICIES)[number];

export const AGENT_PLUGIN_WORKSPACE_SCOPES = ["agent", "execution_workspace"] as const;
export type AgentPluginWorkspaceScope = (typeof AGENT_PLUGIN_WORKSPACE_SCOPES)[number];

const SECRET_ENV_KEY_PATTERNS = [
  /_(TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL|CREDENTIALS|AUTH|APIKEY)$/i,
  /^PRIVATE_/i,
];

export function isSecretEnvKey(key: string): boolean {
  return SECRET_ENV_KEY_PATTERNS.some((re) => re.test(key));
}

export function redactPluginEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = isSecretEnvKey(k) ? "[REDACTED]" : v;
  }
  return out;
}

export interface AgentPluginConfig {
  id: string;
  agentId: string;
  companyId: string;
  kind: AgentPluginConfigKind;
  name: string;
  serverBinary: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  timeoutSec: number;
  restartPolicy: AgentPluginRestartPolicy;
  workspaceScope: AgentPluginWorkspaceScope;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A sanitized descriptor passed to adapters at execution dispatch time.
 * Contains unredacted env so adapters can actually launch the process.
 * Never persisted — only lives in memory during a run.
 */
export interface AgentPluginProcessSpec {
  configId: string;
  kind: AgentPluginConfigKind;
  name: string;
  serverBinary: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  timeoutSec: number;
  restartPolicy: AgentPluginRestartPolicy;
  workspaceScope: AgentPluginWorkspaceScope;
}

export type AgentPluginHealth = "starting" | "running" | "degraded" | "stopped" | "failed";

/**
 * Well-known key under which enabled plugin specs are injected into adapter execution context.
 * Adapters read `ctx.context[AGENT_PLUGIN_SPECS_CONTEXT_KEY]` as `AgentPluginProcessSpec[]`.
 */
export const AGENT_PLUGIN_SPECS_CONTEXT_KEY = "_paperclipAgentPluginSpecs" as const;

import { z } from "zod";
import {
  AGENT_PLUGIN_CONFIG_KINDS,
  AGENT_PLUGIN_RESTART_POLICIES,
  AGENT_PLUGIN_WORKSPACE_SCOPES,
} from "../types/agent-plugin-config.js";

// Valid env var name: letter or underscore start, then letters/digits/underscores
const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Shell-unsafe chars that must never appear in a server binary path
const UNSAFE_BINARY_CHARS_RE = /[;|&`$~<>'"\\]/;
// Reject any path segment that is ".."
const DOTDOT_SEGMENT_RE = /(^|\/)\.\.(\/|$)/;
// Accept: absolute paths (/usr/bin/foo) or plain bare names (node, npx)
const SAFE_BINARY_RE = /^(?:\/[^\s]+|[A-Za-z0-9][A-Za-z0-9._-]*)$/;

export const agentPluginConfigKindSchema = z.enum(AGENT_PLUGIN_CONFIG_KINDS);
export const agentPluginRestartPolicySchema = z.enum(AGENT_PLUGIN_RESTART_POLICIES);
export const agentPluginWorkspaceScopeSchema = z.enum(AGENT_PLUGIN_WORKSPACE_SCOPES);

export const serverBinarySchema = z
  .string()
  .trim()
  .min(1, "server binary must not be empty")
  .max(512, "server binary path too long")
  .refine((v) => !DOTDOT_SEGMENT_RE.test(v), {
    message: "server binary path must not contain .. segments",
  })
  .refine((v) => !UNSAFE_BINARY_CHARS_RE.test(v), {
    message: "server binary path contains unsafe shell characters",
  })
  .refine((v) => SAFE_BINARY_RE.test(v), {
    message: "server binary must be an absolute path or a plain command name (no spaces)",
  });

export const pluginEnvSchema = z
  .record(z.string(), z.string().max(4096, "env value too long"))
  .superRefine((env, ctx) => {
    for (const key of Object.keys(env)) {
      if (!ENV_VAR_NAME_RE.test(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `env key "${key}" is not a valid environment variable name`,
          path: [key],
        });
      }
    }
  });

export const createAgentPluginConfigSchema = z.object({
  kind: agentPluginConfigKindSchema,
  name: z.string().trim().min(1).max(256),
  serverBinary: serverBinarySchema,
  args: z.array(z.string().max(2048, "arg too long")).max(64, "too many args").default([]),
  env: pluginEnvSchema.default({}),
  cwd: z.string().trim().min(1).max(512).nullable().optional(),
  timeoutSec: z.number().int().min(1).max(3600).default(30),
  restartPolicy: agentPluginRestartPolicySchema.default("on_failure"),
  workspaceScope: agentPluginWorkspaceScopeSchema.default("agent"),
  enabled: z.boolean().default(true),
});

export type CreateAgentPluginConfig = z.infer<typeof createAgentPluginConfigSchema>;

export const updateAgentPluginConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
    serverBinary: serverBinarySchema.optional(),
    args: z.array(z.string().max(2048)).max(64).optional(),
    env: pluginEnvSchema.optional(),
    cwd: z.string().trim().min(1).max(512).nullable().optional(),
    timeoutSec: z.number().int().min(1).max(3600).optional(),
    restartPolicy: agentPluginRestartPolicySchema.optional(),
    workspaceScope: agentPluginWorkspaceScopeSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field must be provided" });

export type UpdateAgentPluginConfig = z.infer<typeof updateAgentPluginConfigSchema>;

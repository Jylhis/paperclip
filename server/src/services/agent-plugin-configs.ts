import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentPluginConfigs } from "@paperclipai/db";
import { redactPluginEnv } from "@paperclipai/shared";
import type { CreateAgentPluginConfig, UpdateAgentPluginConfig } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";

function redactConfig(row: typeof agentPluginConfigs.$inferSelect) {
  return { ...row, env: redactPluginEnv(row.env as Record<string, string>) };
}

export function agentPluginConfigService(db: Db) {
  return {
    list: async (agentId: string, companyId: string) => {
      const rows = await db
        .select()
        .from(agentPluginConfigs)
        .where(
          and(
            eq(agentPluginConfigs.agentId, agentId),
            eq(agentPluginConfigs.companyId, companyId),
          ),
        );
      return rows.map(redactConfig);
    },

    create: async (
      agentId: string,
      companyId: string,
      input: CreateAgentPluginConfig,
    ) => {
      const [row] = await db
        .insert(agentPluginConfigs)
        .values({
          agentId,
          companyId,
          kind: input.kind,
          name: input.name,
          serverBinary: input.serverBinary,
          args: input.args ?? [],
          env: input.env ?? {},
          cwd: input.cwd ?? null,
          timeoutSec: input.timeoutSec ?? 30,
          restartPolicy: input.restartPolicy ?? "on_failure",
          workspaceScope: input.workspaceScope ?? "agent",
          enabled: input.enabled ?? true,
        })
        .returning()
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("agent_plugin_configs_agent_name_idx")) {
            throw conflict(`A plugin config named "${input.name}" already exists for this agent`);
          }
          throw err;
        });
      return redactConfig(row);
    },

    update: async (
      configId: string,
      agentId: string,
      companyId: string,
      input: UpdateAgentPluginConfig,
    ) => {
      const existing = await db
        .select()
        .from(agentPluginConfigs)
        .where(
          and(
            eq(agentPluginConfigs.id, configId),
            eq(agentPluginConfigs.agentId, agentId),
            eq(agentPluginConfigs.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Plugin config not found");

      const [updated] = await db
        .update(agentPluginConfigs)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.serverBinary !== undefined && { serverBinary: input.serverBinary }),
          ...(input.args !== undefined && { args: input.args }),
          ...(input.env !== undefined && { env: input.env }),
          ...(input.cwd !== undefined && { cwd: input.cwd }),
          ...(input.timeoutSec !== undefined && { timeoutSec: input.timeoutSec }),
          ...(input.restartPolicy !== undefined && { restartPolicy: input.restartPolicy }),
          ...(input.workspaceScope !== undefined && { workspaceScope: input.workspaceScope }),
          ...(input.enabled !== undefined && { enabled: input.enabled }),
          updatedAt: new Date(),
        })
        .where(eq(agentPluginConfigs.id, configId))
        .returning()
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("agent_plugin_configs_agent_name_idx")) {
            throw conflict(`A plugin config named "${input.name}" already exists for this agent`);
          }
          throw err;
        });
      return redactConfig(updated);
    },

    delete: async (configId: string, agentId: string, companyId: string) => {
      const deleted = await db
        .delete(agentPluginConfigs)
        .where(
          and(
            eq(agentPluginConfigs.id, configId),
            eq(agentPluginConfigs.agentId, agentId),
            eq(agentPluginConfigs.companyId, companyId),
          ),
        )
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!deleted) throw notFound("Plugin config not found");
      return { id: deleted.id };
    },
  };
}

import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

export const agentPluginConfigs = pgTable(
  "agent_plugin_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    serverBinary: text("server_binary").notNull(),
    args: jsonb("args").$type<string[]>().notNull().default([]),
    env: jsonb("env").$type<Record<string, string>>().notNull().default({}),
    cwd: text("cwd"),
    timeoutSec: integer("timeout_sec").notNull().default(30),
    restartPolicy: text("restart_policy").notNull().default("on_failure"),
    workspaceScope: text("workspace_scope").notNull().default("agent"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentNameUniqueIdx: uniqueIndex("agent_plugin_configs_agent_name_idx").on(table.agentId, table.name),
    companyAgentIdx: index("agent_plugin_configs_company_agent_idx").on(table.companyId, table.agentId),
  }),
);

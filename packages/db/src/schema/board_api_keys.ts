import { pgTable, uuid, text, timestamp, index, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";

export const boardApiKeyRequestedAccessEnum = pgEnum("board_api_key_requested_access", ["board", "instance_admin_required"]);

export const boardApiKeys = pgTable(
  "board_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    requestedAccess: boardApiKeyRequestedAccessEnum("requested_access").notNull().default("board"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyHashIdx: uniqueIndex("board_api_keys_key_hash_idx").on(table.keyHash),
    userIdx: index("board_api_keys_user_idx").on(table.userId),
  }),
);

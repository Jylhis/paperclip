import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  expandHomePrefix,
  resolveDefaultEmbeddedPostgresDir,
  resolvePaperclipConfigPathForInstance,
  resolvePaperclipEnvPathForConfig,
} from "@paperclipai/shared/home-paths";
import type { DatabaseTarget } from "./target.js";

const CONFIG_BASENAME = "config.json";

type PartialSocketConfig = {
  socketDir: string;
  name: string;
  user: string;
  port?: number;
};

type PartialConfig = {
  database?: {
    mode?: "embedded-postgres" | "postgres";
    connectionString?: string;
    socket?: PartialSocketConfig;
    embeddedPostgresDataDir?: string;
    embeddedPostgresPort?: number;
    pgliteDataDir?: string;
    pglitePort?: number;
  };
};

export type ResolvedDatabaseTargetSource =
  | "DATABASE_URL"
  | "PAPERCLIP_DATABASE_SOCKET"
  | "paperclip-env"
  | "config.database.socket"
  | "config.database.connectionString";

export type ResolvedDatabaseTarget =
  | {
      mode: "postgres";
      target: DatabaseTarget;
      source: ResolvedDatabaseTargetSource;
      configPath: string;
      envPath: string;
    }
  | {
      mode: "embedded-postgres";
      dataDir: string;
      port: number;
      source: `embedded-postgres@${number}`;
      configPath: string;
      envPath: string;
    };

function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}

function findConfigFileFromAncestors(startDir: string): string | null {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.resolve(currentDir, ".paperclip", CONFIG_BASENAME);
    if (existsSync(candidate)) return candidate;

    const nextDir = path.resolve(currentDir, "..");
    if (nextDir === currentDir) return null;
    currentDir = nextDir;
  }
}

function resolvePaperclipConfigPath(): string {
  if (process.env.PAPERCLIP_CONFIG?.trim()) {
    return path.resolve(process.env.PAPERCLIP_CONFIG.trim());
  }
  return findConfigFileFromAncestors(process.cwd()) ?? resolvePaperclipConfigPathForInstance();
}

function resolvePaperclipEnvPath(configPath: string): string {
  return resolvePaperclipEnvPathForConfig(configPath);
}

function parseEnvFile(contents: string): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (!value) {
      entries[key] = "";
      continue;
    }

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      entries[key] = value.slice(1, -1);
      continue;
    }

    entries[key] = value.replace(/\s+#.*$/, "").trim();
  }

  return entries;
}

function readEnvEntries(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};
  return parseEnvFile(readFileSync(envPath, "utf8"));
}

function migrateLegacyConfig(raw: unknown): PartialConfig | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

  const config = { ...(raw as Record<string, unknown>) };
  const databaseRaw = config.database;
  if (typeof databaseRaw !== "object" || databaseRaw === null || Array.isArray(databaseRaw)) {
    return config;
  }

  const database = { ...(databaseRaw as Record<string, unknown>) };
  if (database.mode === "pglite") {
    database.mode = "embedded-postgres";

    if (
      typeof database.embeddedPostgresDataDir !== "string" &&
      typeof database.pgliteDataDir === "string"
    ) {
      database.embeddedPostgresDataDir = database.pgliteDataDir;
    }
    if (
      typeof database.embeddedPostgresPort !== "number" &&
      typeof database.pglitePort === "number" &&
      Number.isFinite(database.pglitePort)
    ) {
      database.embeddedPostgresPort = database.pglitePort;
    }
  }

  config.database = database;
  return config as PartialConfig;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.trunc(value);
  return rounded > 0 ? rounded : null;
}

function readConfig(configPath: string): PartialConfig | null {
  if (!existsSync(configPath)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new Error(
      `Failed to parse config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const migrated = migrateLegacyConfig(parsed);
  if (migrated === null || typeof migrated !== "object" || Array.isArray(migrated)) {
    throw new Error(`Invalid config at ${configPath}: expected a JSON object`);
  }

  const database =
    typeof migrated.database === "object" &&
    migrated.database !== null &&
    !Array.isArray(migrated.database)
      ? migrated.database
      : undefined;

  return {
    database: database
      ? {
          mode: database.mode === "postgres" ? "postgres" : "embedded-postgres",
          connectionString:
            typeof database.connectionString === "string" ? database.connectionString : undefined,
          socket: readSocketConfig(database.socket),
          embeddedPostgresDataDir:
            typeof database.embeddedPostgresDataDir === "string"
              ? database.embeddedPostgresDataDir
              : undefined,
          embeddedPostgresPort: asPositiveInt(database.embeddedPostgresPort) ?? undefined,
          pgliteDataDir: typeof database.pgliteDataDir === "string" ? database.pgliteDataDir : undefined,
          pglitePort: asPositiveInt(database.pglitePort) ?? undefined,
        }
      : undefined,
  };
}

function readSocketConfig(raw: unknown): PartialSocketConfig | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const socketDir = typeof obj.socketDir === "string" ? obj.socketDir.trim() : "";
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const user = typeof obj.user === "string" ? obj.user.trim() : "";
  if (!socketDir || !name || !user) return undefined;
  const port = asPositiveInt(obj.port);
  return {
    socketDir,
    name,
    user,
    ...(port !== null ? { port } : {}),
  };
}

function resolveSocketEnvTarget(
  configPath: string,
  envPath: string,
): ResolvedDatabaseTarget | null {
  const socketDir = process.env.PAPERCLIP_DATABASE_SOCKET_DIR?.trim();
  const name = process.env.PAPERCLIP_DATABASE_NAME?.trim();
  const user = process.env.PAPERCLIP_DATABASE_USER?.trim();
  const portRaw = process.env.PAPERCLIP_DATABASE_PORT?.trim();

  const provided = [
    ["PAPERCLIP_DATABASE_SOCKET_DIR", socketDir],
    ["PAPERCLIP_DATABASE_NAME", name],
    ["PAPERCLIP_DATABASE_USER", user],
  ] as const;

  const anyProvided = provided.some(([, value]) => Boolean(value));
  const allProvided = provided.every(([, value]) => Boolean(value));

  if (!anyProvided) return null;

  if (!allProvided) {
    const missing = provided.filter(([, value]) => !value).map(([key]) => key);
    throw new Error(
      `PAPERCLIP_DATABASE_SOCKET_DIR requires PAPERCLIP_DATABASE_NAME and PAPERCLIP_DATABASE_USER; missing: ${missing.join(", ")}`,
    );
  }

  let port: number | undefined;
  if (portRaw) {
    const parsed = Number(portRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(
        `PAPERCLIP_DATABASE_PORT must be an integer between 1 and 65535, got "${portRaw}"`,
      );
    }
    port = parsed;
  }

  return {
    mode: "postgres",
    target: {
      kind: "socket",
      socketDir: socketDir!,
      database: name!,
      user: user!,
      ...(port !== undefined ? { port } : {}),
    },
    source: "PAPERCLIP_DATABASE_SOCKET",
    configPath,
    envPath,
  };
}

export function resolveDatabaseTarget(): ResolvedDatabaseTarget {
  const configPath = resolvePaperclipConfigPath();
  const envPath = resolvePaperclipEnvPath(configPath);
  const envEntries = readEnvEntries(envPath);

  const envUrl = process.env.DATABASE_URL?.trim();
  if (envUrl) {
    return {
      mode: "postgres",
      target: { kind: "url", connectionString: envUrl },
      source: "DATABASE_URL",
      configPath,
      envPath,
    };
  }

  const socketEnvTarget = resolveSocketEnvTarget(configPath, envPath);
  if (socketEnvTarget) return socketEnvTarget;

  const fileEnvUrl = envEntries.DATABASE_URL?.trim();
  if (fileEnvUrl) {
    return {
      mode: "postgres",
      target: { kind: "url", connectionString: fileEnvUrl },
      source: "paperclip-env",
      configPath,
      envPath,
    };
  }

  const config = readConfig(configPath);
  const socket = config?.database?.socket;
  if (socket) {
    return {
      mode: "postgres",
      target: {
        kind: "socket",
        socketDir: socket.socketDir,
        database: socket.name,
        user: socket.user,
        ...(socket.port !== undefined ? { port: socket.port } : {}),
      },
      source: "config.database.socket",
      configPath,
      envPath,
    };
  }

  const connectionString = config?.database?.connectionString?.trim();
  if (config?.database?.mode === "postgres" && connectionString) {
    return {
      mode: "postgres",
      target: { kind: "url", connectionString },
      source: "config.database.connectionString",
      configPath,
      envPath,
    };
  }

  const port = config?.database?.embeddedPostgresPort ?? 54329;
  const dataDir = resolveHomeAwarePath(
    config?.database?.embeddedPostgresDataDir ?? resolveDefaultEmbeddedPostgresDir(),
  );

  return {
    mode: "embedded-postgres",
    dataDir,
    port,
    source: `embedded-postgres@${port}`,
    configPath,
    envPath,
  };
}

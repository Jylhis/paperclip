import path from "node:path";
import { logger } from "../middleware/logger.js";
import { pluginLoader } from "./plugin-loader.js";
import { pluginRegistryService } from "./plugin-registry.js";

type DefaultPluginLoader = Pick<ReturnType<typeof pluginLoader>, "installPlugin" | "loadManifest">;
type DefaultPluginRegistry = Pick<ReturnType<typeof pluginRegistryService>, "getByKey">;

export function parseDefaultLocalPluginPaths(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export async function ensureDefaultLocalPluginsInstalled(opts: {
  pluginPaths?: string[];
  loader: DefaultPluginLoader;
  registry: DefaultPluginRegistry;
  log?: Pick<typeof logger, "info" | "warn">;
}): Promise<string[]> {
  const {
    pluginPaths,
    loader,
    registry,
    log = logger,
  } = opts;

  const pluginIdsToLoad: string[] = [];

  for (const pluginPath of pluginPaths ?? []) {
    try {
      const manifest = await loader.loadManifest(pluginPath);
      if (!manifest) {
        log.warn({ pluginPath }, "default plugin path does not expose a Paperclip manifest");
        continue;
      }

      const existing = await registry.getByKey(manifest.id);
      if (existing) {
        if (existing.status === "installed") {
          pluginIdsToLoad.push(existing.id);
        }
        continue;
      }

      await loader.installPlugin({ localPath: pluginPath });
      const installed = await registry.getByKey(manifest.id);
      if (!installed) {
        throw new Error(`Plugin install did not create a registry row for ${manifest.id}`);
      }

      pluginIdsToLoad.push(installed.id);
      log.info({ pluginKey: manifest.id, pluginPath }, "installed default local plugin");
    } catch (err) {
      log.warn(
        {
          pluginPath,
          err: err instanceof Error ? err.message : String(err),
        },
        "failed to install default local plugin",
      );
    }
  }

  return [...new Set(pluginIdsToLoad)];
}

export function defaultLocalPluginPathsFromEnv(
  raw = process.env.PAPERCLIP_DEFAULT_LOCAL_PLUGINS,
): string[] {
  return parseDefaultLocalPluginPaths(raw);
}

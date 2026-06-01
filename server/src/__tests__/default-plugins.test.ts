import { describe, expect, it, vi } from "vitest";
import { defaultLocalPluginPathsFromEnv, ensureDefaultLocalPluginsInstalled, parseDefaultLocalPluginPaths } from "../services/default-plugins.js";

describe("default local plugins", () => {
  it("parses path-delimited plugin lists", () => {
    expect(parseDefaultLocalPluginPaths("/a:/b::/c")).toEqual(["/a", "/b", "/c"]);
  });

  it("installs missing plugins and activates them once", async () => {
    const manifests = new Map([
      ["/plugins/wiki", { id: "paperclipai.plugin-llm-wiki" }],
      ["/plugins/diff", { id: "paperclipai.plugin-workspace-diff" }],
    ]);
    const installs: string[] = [];
    const rows = new Map<string, { id: string; status: string }>([
      ["paperclipai.plugin-workspace-diff", { id: "plg-diff", status: "installed" }],
    ]);

    const pluginIds = await ensureDefaultLocalPluginsInstalled({
      pluginPaths: ["/plugins/wiki", "/plugins/diff"],
      loader: {
        loadManifest: vi.fn(async (pluginPath: string) => manifests.get(pluginPath) as { id: string } | null),
        installPlugin: vi.fn(async ({ localPath }: { localPath?: string }) => {
          installs.push(localPath ?? "");
          rows.set("paperclipai.plugin-llm-wiki", { id: "plg-wiki", status: "installed" });
          return { manifest: { id: "paperclipai.plugin-llm-wiki" } };
        }),
      },
      registry: {
        getByKey: vi.fn(async (pluginKey: string) => rows.get(pluginKey) ?? null),
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(installs).toEqual(["/plugins/wiki"]);
    expect(pluginIds).toEqual(["plg-wiki", "plg-diff"]);
  });

  it("skips already-managed plugins without re-installing them", async () => {
    const installPlugin = vi.fn();

    const pluginIds = await ensureDefaultLocalPluginsInstalled({
      pluginPaths: ["/plugins/wiki"],
      loader: {
        loadManifest: vi.fn(async () => ({ id: "paperclipai.plugin-llm-wiki" })),
        installPlugin,
      },
      registry: {
        getByKey: vi.fn(async () => ({ id: "plg-wiki", status: "disabled" })),
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(installPlugin).not.toHaveBeenCalled();
    expect(pluginIds).toEqual([]);
  });

  it("reads default plugin paths from the environment helper", () => {
    expect(defaultLocalPluginPathsFromEnv("/wiki:/diff")).toEqual(["/wiki", "/diff"]);
  });
});

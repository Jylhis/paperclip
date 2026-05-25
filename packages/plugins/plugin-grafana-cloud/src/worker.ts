import { definePlugin, type PluginContext } from "@paperclipai/plugin-sdk";
import manifest, { TOOL_NAMES } from "./manifest.js";
import { parseInstanceConfig, type InstanceConfigShape, type CompanyOverride } from "./config.js";
import { dispatchTool } from "./tools/index.js";

const COMPANY_OVERRIDE_NS = "config";
const COMPANY_OVERRIDE_KEY = "override";

export default definePlugin({
  async setup(ctx: PluginContext) {
    let instanceConfig: InstanceConfigShape;
    try {
      instanceConfig = parseInstanceConfig(await ctx.config.get());
    } catch (err) {
      ctx.logger.error("plugin-grafana-cloud: instance config invalid; tools will fail until fixed", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Stub a placeholder so handler registration still runs — every tool
      // call will return a structured error rather than crashing the worker.
      instanceConfig = { defaults: { stackSlug: "", region: "", cloudAccessTokenRef: "", stackTokenRef: "" } };
    }

    const loadCompanyOverride = async (companyId: string): Promise<CompanyOverride | null> => {
      const raw = (await ctx.state.get({
        scopeKind: "company",
        scopeId: companyId,
        namespace: COMPANY_OVERRIDE_NS,
        stateKey: COMPANY_OVERRIDE_KEY,
      })) as Record<string, unknown> | null;
      if (!raw) return null;
      return {
        stackSlug: typeof raw.stackSlug === "string" ? raw.stackSlug : undefined,
        region: typeof raw.region === "string" ? raw.region : undefined,
        cloudAccessTokenRef:
          typeof raw.cloudAccessTokenRef === "string" ? raw.cloudAccessTokenRef : undefined,
        stackTokenRef: typeof raw.stackTokenRef === "string" ? raw.stackTokenRef : undefined,
        timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : undefined,
        httpRetryCount: typeof raw.httpRetryCount === "number" ? raw.httpRetryCount : undefined,
      };
    };

    // Register every declared tool with the same dispatcher. The dispatcher
    // looks up the implementation by name in the tools registry.
    for (const toolDecl of manifest.tools ?? []) {
      ctx.tools.register(
        toolDecl.name,
        {
          displayName: toolDecl.displayName,
          description: toolDecl.description,
          parametersSchema: toolDecl.parametersSchema,
        },
        async (params, runCtx) =>
          dispatchTool({
            name: toolDecl.name,
            params,
            ctx,
            runCtx,
            instanceConfig,
            loadCompanyOverride,
          }),
      );
    }
    ctx.logger.info("plugin-grafana-cloud: registered tools", { count: TOOL_NAMES.length });

    // Save-company-override action used by the company settings page.
    ctx.actions.register("save-company-override", async (raw) => {
      const params = (raw ?? {}) as Record<string, unknown>;
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      if (!companyId) throw new Error("companyId required");
      const override: CompanyOverride = {
        stackSlug: typeof params.stackSlug === "string" ? params.stackSlug : undefined,
        region: typeof params.region === "string" ? params.region : undefined,
        cloudAccessTokenRef:
          typeof params.cloudAccessTokenRef === "string" ? params.cloudAccessTokenRef : undefined,
        stackTokenRef: typeof params.stackTokenRef === "string" ? params.stackTokenRef : undefined,
      };
      await ctx.state.set(
        {
          scopeKind: "company",
          scopeId: companyId,
          namespace: COMPANY_OVERRIDE_NS,
          stateKey: COMPANY_OVERRIDE_KEY,
        },
        override,
      );
      // Invalidate the stack cache so the next tool call re-resolves endpoints
      // against the new stack slug.
      await ctx.state.delete({
        scopeKind: "company",
        scopeId: companyId,
        namespace: "stack-cache",
        stateKey: override.stackSlug ?? instanceConfig.defaults.stackSlug,
      }).catch(() => undefined);
      return { ok: true };
    });

    // getData handler for the OverviewPage UI.
    ctx.data.register("overview", async (params) => {
      const companyId = typeof (params as Record<string, unknown>)?.companyId === "string"
        ? ((params as Record<string, unknown>).companyId as string)
        : "";
      if (!companyId) return { error: "companyId required" };

      try {
        const stacks = await dispatchTool({
          name: "cloud_list_stacks",
          params: { companyId },
          ctx,
          runCtx: { agentId: "ui", runId: "ui", companyId, projectId: "" },
          instanceConfig,
          loadCompanyOverride,
        });
        const incidents = await dispatchTool({
          name: "irm_list_incidents",
          params: { companyId, status: "active", limit: 10 },
          ctx,
          runCtx: { agentId: "ui", runId: "ui", companyId, projectId: "" },
          instanceConfig,
          loadCompanyOverride,
        });
        const alerts = await dispatchTool({
          name: "mimir_list_alertmanager_alerts",
          params: { companyId, active: true },
          ctx,
          runCtx: { agentId: "ui", runId: "ui", companyId, projectId: "" },
          instanceConfig,
          loadCompanyOverride,
        });
        return {
          stacks: stacks.data ?? null,
          incidents: incidents.data ?? null,
          alerts: alerts.data ?? null,
          errors: [stacks.error, incidents.error, alerts.error].filter(Boolean),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });
  },

  async onConfigChanged() {
    // Stack caches are scoped by companyId+stackSlug. They expire on TTL, and
    // are invalidated on override-save. A config change at the instance level
    // is rare enough that we let the TTL handle it.
  },
});

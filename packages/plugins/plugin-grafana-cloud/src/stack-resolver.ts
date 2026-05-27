import { z, type PluginContext, type ToolRunContext } from "@paperclipai/plugin-sdk";
import type { GrafanaCloudPluginConfig } from "./config.js";

// Shape returned by https://grafana.com/api/instances/<slug>. All sub-instance
// fields are optional because grafana.com omits them for stacks where the
// corresponding service isn't provisioned (e.g. a Loki-only stack lacks the
// `ht*` Tempo fields). Unknown keys are stripped so future API additions don't
// crash the parser.
const StackLookupResponseSchema = z.object({
  id: z.number(),
  slug: z.string(),
  regionSlug: z.string().optional(),
  region: z.string().optional(),
  url: z.string(),
  hlInstanceId: z.number().optional(),
  hlInstanceUrl: z.string().optional(),
  hmInstanceId: z.number().optional(),
  hmInstancePromUrl: z.string().optional(),
  htInstanceId: z.number().optional(),
  htInstanceUrl: z.string().optional(),
  hpInstanceId: z.number().optional(),
  hpInstanceUrl: z.string().optional(),
  amInstanceUrl: z.string().optional(),
});

// Cached output of resolveStackEndpoints. Reused by worker.ts to re-validate
// values pulled out of plugin state — old cache entries written before a schema
// change get rejected and force a refetch.
export const ResolvedStackSchema = z.object({
  id: z.number(),
  slug: z.string(),
  region: z.string(),
  grafanaUrl: z.string(),
  lokiUrl: z.string(),
  lokiInstanceId: z.number(),
  tempoUrl: z.string(),
  tempoInstanceId: z.number(),
  mimirPromUrl: z.string(),
  mimirInstanceId: z.number(),
  pyroscopeUrl: z.string(),
  pyroscopeInstanceId: z.number(),
  faroUrl: z.string(),
  smUrl: z.string(),
  oncallUrl: z.string(),
  irmUrl: z.string(),
  k6Url: z.string(),
  alertmanagerUrl: z.string(),
  fetchedAt: z.number(),
});

export type ResolvedStack = z.infer<typeof ResolvedStackSchema>;

const STACK_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Look up per-service endpoint URLs for a stack and cache them in plugin
 * state for an hour. The cache is keyed by `(companyId, stackSlug)` so a
 * per-company override that flips the stack invalidates correctly.
 *
 * The lookup hits `grafana.com/api/instances/<slug>` and pulls the public
 * URLs of each bundled tenant (Loki, Tempo, Mimir, Pyroscope, etc.). For
 * sub-services that grafana.com doesn't surface directly (Synthetic, OnCall,
 * IRM, k6, Faro), endpoints are derived from the region slug.
 */
export async function resolveStackEndpoints(input: {
  ctx: PluginContext;
  config: GrafanaCloudPluginConfig;
  runCtx: ToolRunContext;
  cloudAccessToken: string;
}): Promise<ResolvedStack> {
  const cacheKey = {
    scopeKind: "company" as const,
    scopeId: input.runCtx.companyId,
    namespace: "stack-cache",
    stateKey: input.config.stackSlug,
  };
  const cachedRaw = await input.ctx.state.get(cacheKey);
  if (cachedRaw !== null && cachedRaw !== undefined) {
    const cached = ResolvedStackSchema.safeParse(cachedRaw);
    if (cached.success && Date.now() - cached.data.fetchedAt < STACK_CACHE_TTL_MS) {
      return cached.data;
    }
    // Schema drift or expired entry: drop it and fall through to a refetch so
    // the new shape lands in the cache.
    await input.ctx.state.delete(cacheKey);
  }

  const url = `https://grafana.com/api/instances/${encodeURIComponent(input.config.stackSlug)}`;
  // Bound the stack lookup so a slow grafana.com never hangs a tool call.
  // Timer covers both headers and body — if the upstream sends headers but
  // stalls the JSON body the abort still fires.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.config.timeoutMs ?? 30_000,
  );
  let raw: z.infer<typeof StackLookupResponseSchema>;
  try {
    const res = await input.ctx.http.fetch(url, {
      headers: {
        Authorization: `Bearer ${input.cloudAccessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `Grafana Cloud stack lookup failed for "${input.config.stackSlug}": ${res.status} ${res.statusText}`,
      );
    }
    const parsed = StackLookupResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(
        `Grafana Cloud stack lookup for "${input.config.stackSlug}" returned an ` +
          `unexpected shape: ${parsed.error.issues
            .map((issue: z.ZodIssue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
            .join("; ")}`,
      );
    }
    raw = parsed.data;
  } finally {
    clearTimeout(timer);
  }
  const region = raw.regionSlug ?? raw.region ?? input.config.region;
  const resolved: ResolvedStack = {
    id: raw.id,
    slug: raw.slug,
    region,
    grafanaUrl: stripTrailingSlash(raw.url),
    lokiUrl: stripTrailingSlash(raw.hlInstanceUrl ?? ""),
    lokiInstanceId: raw.hlInstanceId ?? 0,
    tempoUrl: stripTrailingSlash(raw.htInstanceUrl ?? ""),
    tempoInstanceId: raw.htInstanceId ?? 0,
    mimirPromUrl: stripTrailingSlash(raw.hmInstancePromUrl ?? ""),
    mimirInstanceId: raw.hmInstanceId ?? 0,
    pyroscopeUrl: stripTrailingSlash(raw.hpInstanceUrl ?? `https://profiles-${region}.grafana.net`),
    pyroscopeInstanceId: raw.hpInstanceId ?? 0,
    faroUrl: `https://faro-api-${region}.grafana.net`,
    smUrl: `https://synthetic-monitoring-api-${region}.grafana.net`,
    oncallUrl: `https://oncall-prod-${region}.grafana.net`,
    irmUrl: `${stripTrailingSlash(raw.url)}/api/plugins/grafana-incident-app`,
    k6Url: "https://api.k6.io",
    alertmanagerUrl: stripTrailingSlash(raw.amInstanceUrl ?? `${raw.url}/api/alertmanager/grafana`),
    fetchedAt: Date.now(),
  };
  await input.ctx.state.set(cacheKey, resolved);
  return resolved;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

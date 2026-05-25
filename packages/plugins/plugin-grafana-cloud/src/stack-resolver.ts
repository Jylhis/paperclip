import type { PluginContext, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { GrafanaCloudPluginConfig } from "./config.js";

export interface ResolvedStack {
  id: number;
  slug: string;
  region: string;
  grafanaUrl: string;
  lokiUrl: string;
  lokiInstanceId: number;
  tempoUrl: string;
  tempoInstanceId: number;
  mimirPromUrl: string;
  mimirInstanceId: number;
  pyroscopeUrl: string;
  pyroscopeInstanceId: number;
  faroUrl: string;
  smUrl: string;
  oncallUrl: string;
  irmUrl: string;
  k6Url: string;
  alertmanagerUrl: string;
  fetchedAt: number;
}

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
  const cached = (await input.ctx.state.get(cacheKey)) as ResolvedStack | null;
  if (cached && Date.now() - cached.fetchedAt < STACK_CACHE_TTL_MS) {
    return cached;
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
  let raw: {
    id: number;
    slug: string;
    regionSlug?: string;
    region?: string;
    url: string;
    hlInstanceId?: number;
    hlInstanceUrl?: string;
    hmInstanceId?: number;
    hmInstancePromUrl?: string;
    htInstanceId?: number;
    htInstanceUrl?: string;
    hpInstanceId?: number;
    hpInstanceUrl?: string;
    amInstanceUrl?: string;
  };
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
    raw = (await res.json()) as {
      id: number;
      slug: string;
      regionSlug?: string;
      region?: string;
      url: string;
      hlInstanceId?: number;
      hlInstanceUrl?: string;
      hmInstanceId?: number;
      hmInstancePromUrl?: string;
      htInstanceId?: number;
      htInstanceUrl?: string;
      hpInstanceId?: number;
      hpInstanceUrl?: string;
      amInstanceUrl?: string;
    };
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

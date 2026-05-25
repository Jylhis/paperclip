export interface GrafanaCloudStackInfo {
  id: number;
  slug: string;
  region: string;
  url: string;
  hlInstanceId: number;
  hlInstanceUrl: string;
  hmInstanceId: number;
  hmInstancePromUrl: string;
  htInstanceId: number;
  htInstanceUrl: string;
  otlpEndpoint: string;
  otlpInstanceId: number;
}

interface RawStackInfo {
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
  otlpUrl?: string;
}

/**
 * Look up Grafana Cloud stack metadata from grafana.com. The response carries
 * per-service endpoint URLs (Loki, Mimir, Tempo) and the numeric instance ID
 * used as the OTLP gateway Basic-auth username.
 */
export async function fetchGrafanaCloudStackInfo(input: {
  stackSlug: string;
  cloudAccessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<GrafanaCloudStackInfo> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `https://grafana.com/api/instances/${encodeURIComponent(input.stackSlug)}`;
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${input.cloudAccessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(
      `grafana.com stack lookup failed for slug=${input.stackSlug}: ${res.status} ${res.statusText}`,
    );
  }
  const raw = (await res.json()) as RawStackInfo;
  const otlpEndpoint = raw.otlpUrl ?? deriveOtlpEndpoint(raw.regionSlug ?? raw.region ?? "");
  if (!otlpEndpoint) {
    throw new Error(
      `cannot determine OTLP endpoint for stack ${input.stackSlug}: stack info has no otlpUrl and no region slug`,
    );
  }
  return {
    id: raw.id,
    slug: raw.slug,
    region: raw.regionSlug ?? raw.region ?? "",
    url: raw.url,
    hlInstanceId: raw.hlInstanceId ?? 0,
    hlInstanceUrl: raw.hlInstanceUrl ?? "",
    hmInstanceId: raw.hmInstanceId ?? 0,
    hmInstancePromUrl: raw.hmInstancePromUrl ?? "",
    htInstanceId: raw.htInstanceId ?? 0,
    htInstanceUrl: raw.htInstanceUrl ?? "",
    otlpEndpoint: otlpEndpoint.replace(/\/$/, ""),
    otlpInstanceId: raw.id,
  };
}

function deriveOtlpEndpoint(regionSlug: string): string {
  if (!regionSlug) return "";
  return `https://otlp-gateway-${regionSlug}.grafana.net/otlp`;
}

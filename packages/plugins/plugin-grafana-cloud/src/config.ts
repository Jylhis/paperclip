// Grafana Cloud region slugs are of the form `prod-us-east-0`, `prod-eu-west-1`,
// etc. The slug is interpolated into per-service hostnames like
// `https://faro-api-${region}.grafana.net` in stack-resolver.ts, so a malformed
// value (containing `/`, `.`, ":") would let an operator typo land somewhere
// other than `*.grafana.net`. Restrict to lowercase letters, digits, and `-`,
// starting with an alphanumeric.
const REGION_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidRegionSlug(region: string): boolean {
  return REGION_SLUG_PATTERN.test(region);
}

/**
 * Per-call configuration resolved from instance defaults + per-company
 * override (stored in `ctx.state`). Tokens here are *references* — the worker
 * resolves them through `ctx.secrets.resolve()` only at execution time.
 */
export interface GrafanaCloudPluginConfig {
  stackSlug: string;
  region: string;
  cloudAccessTokenRef: string;
  stackTokenRef: string;
  timeoutMs: number;
  httpRetryCount: number;
}

export interface InstanceDefaults {
  stackSlug: string;
  region: string;
  cloudAccessTokenRef: string;
  stackTokenRef: string;
  timeoutMs?: number;
  httpRetryCount?: number;
}

export interface CompanyOverride {
  stackSlug?: string;
  region?: string;
  cloudAccessTokenRef?: string;
  stackTokenRef?: string;
  timeoutMs?: number;
  httpRetryCount?: number;
}

export interface InstanceConfigShape {
  defaults: InstanceDefaults;
}

export function parseInstanceConfig(raw: unknown): InstanceConfigShape {
  if (!raw || typeof raw !== "object") {
    throw new Error("plugin-grafana-cloud: instance config is missing");
  }
  const obj = raw as Record<string, unknown>;
  const defaults = obj.defaults as Record<string, unknown> | undefined;
  if (!defaults) {
    throw new Error("plugin-grafana-cloud: instance config has no `defaults` block");
  }
  const stackSlug = stringField(defaults, "stackSlug");
  const region = stringField(defaults, "region");
  const cloudAccessTokenRef = stringField(defaults, "cloudAccessTokenRef");
  const stackTokenRef = stringField(defaults, "stackTokenRef");
  if (!stackSlug || !region || !cloudAccessTokenRef || !stackTokenRef) {
    throw new Error(
      "plugin-grafana-cloud: instance config missing required fields (stackSlug, region, cloudAccessTokenRef, stackTokenRef)",
    );
  }
  if (!isValidRegionSlug(region)) {
    throw new Error(
      `plugin-grafana-cloud: region "${region}" is not a valid Grafana Cloud region slug (expected lowercase alphanumerics and hyphens, e.g. "prod-us-east-0")`,
    );
  }
  return {
    defaults: {
      stackSlug,
      region,
      cloudAccessTokenRef,
      stackTokenRef,
      timeoutMs: numberField(defaults, "timeoutMs"),
      httpRetryCount: numberField(defaults, "httpRetryCount"),
    },
  };
}

export function mergeConfig(
  defaults: InstanceDefaults,
  override: CompanyOverride | null,
): GrafanaCloudPluginConfig {
  return {
    stackSlug: override?.stackSlug ?? defaults.stackSlug,
    region: override?.region ?? defaults.region,
    cloudAccessTokenRef: override?.cloudAccessTokenRef ?? defaults.cloudAccessTokenRef,
    stackTokenRef: override?.stackTokenRef ?? defaults.stackTokenRef,
    timeoutMs: override?.timeoutMs ?? defaults.timeoutMs ?? 30_000,
    httpRetryCount: override?.httpRetryCount ?? defaults.httpRetryCount ?? 2,
  };
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function numberField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

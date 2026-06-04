import { readFileSync } from "node:fs";

export interface GrafanaCloudObservabilityConfig {
  enabled: boolean;
  stackSlug: string;
  region: string;
  serviceName: string;
  deploymentEnv: string;
  samplingRatio: number;
  cloudAccessToken: string;
  stackToken: string;
}

export interface ObservabilityBootstrapConfig {
  selfTelemetry: GrafanaCloudObservabilityConfig | null;
}

function readTokenFile(envVarName: string): string | null {
  const path = process.env[envVarName]?.trim();
  if (!path) return null;
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function parseSamplingRatio(raw: string | undefined): number {
  if (!raw) return 0.1;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0.1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function loadObservabilityConfig(): ObservabilityBootstrapConfig {
  const enabledRaw = process.env.GRAFANA_CLOUD_SELF_TELEMETRY_ENABLED?.trim().toLowerCase();
  const enabled = enabledRaw === "true" || enabledRaw === "1";

  const stackSlug = process.env.GRAFANA_CLOUD_STACK_SLUG?.trim() ?? "";
  const region = process.env.GRAFANA_CLOUD_REGION?.trim() ?? "";
  const cloudAccessToken = readTokenFile("GRAFANA_CLOUD_CLOUD_TOKEN_FILE");
  const stackToken = readTokenFile("GRAFANA_CLOUD_STACK_TOKEN_FILE");

  if (!enabled || !stackSlug || !region || !cloudAccessToken || !stackToken) {
    return { selfTelemetry: null };
  }

  return {
    selfTelemetry: {
      enabled: true,
      stackSlug,
      region,
      serviceName: process.env.OTEL_SERVICE_NAME?.trim() || "paperclip-server",
      deploymentEnv:
        parseResourceAttr(process.env.OTEL_RESOURCE_ATTRIBUTES, "deployment.environment") ?? "prod",
      samplingRatio: parseSamplingRatio(process.env.OTEL_TRACES_SAMPLER_ARG),
      cloudAccessToken,
      stackToken,
    },
  };
}

function parseResourceAttr(raw: string | undefined, key: string): string | null {
  if (!raw) return null;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() === key) {
      return pair.slice(eq + 1).trim();
    }
  }
  return null;
}

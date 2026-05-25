import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadObservabilityConfig } from "../../observability/config.js";

describe("loadObservabilityConfig", () => {
  const originalEnv = { ...process.env };
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "paperclip-obs-cfg-"));
    delete process.env.GRAFANA_CLOUD_SELF_TELEMETRY_ENABLED;
    delete process.env.GRAFANA_CLOUD_STACK_SLUG;
    delete process.env.GRAFANA_CLOUD_REGION;
    delete process.env.GRAFANA_CLOUD_CLOUD_TOKEN_FILE;
    delete process.env.GRAFANA_CLOUD_STACK_TOKEN_FILE;
    delete process.env.OTEL_TRACES_SAMPLER_ARG;
    delete process.env.OTEL_RESOURCE_ATTRIBUTES;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it("returns null self-telemetry when env disabled", () => {
    expect(loadObservabilityConfig().selfTelemetry).toBeNull();
  });

  it("returns null when enabled but token files missing", () => {
    process.env.GRAFANA_CLOUD_SELF_TELEMETRY_ENABLED = "true";
    process.env.GRAFANA_CLOUD_STACK_SLUG = "test";
    process.env.GRAFANA_CLOUD_REGION = "prod-eu-west-2";
    expect(loadObservabilityConfig().selfTelemetry).toBeNull();
  });

  it("loads full config when all env present and token files readable", () => {
    const cloudTokenPath = join(tmp, "cloud.token");
    const stackTokenPath = join(tmp, "stack.token");
    writeFileSync(cloudTokenPath, "cloud-abc\n");
    writeFileSync(stackTokenPath, "stack-xyz");

    process.env.GRAFANA_CLOUD_SELF_TELEMETRY_ENABLED = "true";
    process.env.GRAFANA_CLOUD_STACK_SLUG = "acmeprod";
    process.env.GRAFANA_CLOUD_REGION = "prod-us-east-0";
    process.env.GRAFANA_CLOUD_CLOUD_TOKEN_FILE = cloudTokenPath;
    process.env.GRAFANA_CLOUD_STACK_TOKEN_FILE = stackTokenPath;
    process.env.OTEL_TRACES_SAMPLER_ARG = "0.42";
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "service.namespace=paperclip,deployment.environment=staging";

    const cfg = loadObservabilityConfig();
    expect(cfg.selfTelemetry).not.toBeNull();
    expect(cfg.selfTelemetry?.stackSlug).toBe("acmeprod");
    expect(cfg.selfTelemetry?.region).toBe("prod-us-east-0");
    expect(cfg.selfTelemetry?.cloudAccessToken).toBe("cloud-abc");
    expect(cfg.selfTelemetry?.stackToken).toBe("stack-xyz");
    expect(cfg.selfTelemetry?.deploymentEnv).toBe("staging");
    expect(cfg.selfTelemetry?.samplingRatio).toBeCloseTo(0.42);
  });

  it("clamps sampling ratio to [0, 1]", () => {
    const cloudTokenPath = join(tmp, "c");
    const stackTokenPath = join(tmp, "s");
    writeFileSync(cloudTokenPath, "c");
    writeFileSync(stackTokenPath, "s");
    process.env.GRAFANA_CLOUD_SELF_TELEMETRY_ENABLED = "true";
    process.env.GRAFANA_CLOUD_STACK_SLUG = "x";
    process.env.GRAFANA_CLOUD_REGION = "x";
    process.env.GRAFANA_CLOUD_CLOUD_TOKEN_FILE = cloudTokenPath;
    process.env.GRAFANA_CLOUD_STACK_TOKEN_FILE = stackTokenPath;

    process.env.OTEL_TRACES_SAMPLER_ARG = "5";
    expect(loadObservabilityConfig().selfTelemetry?.samplingRatio).toBe(1);
    process.env.OTEL_TRACES_SAMPLER_ARG = "-1";
    expect(loadObservabilityConfig().selfTelemetry?.samplingRatio).toBe(0);
    process.env.OTEL_TRACES_SAMPLER_ARG = "not-a-number";
    expect(loadObservabilityConfig().selfTelemetry?.samplingRatio).toBeCloseTo(0.1);
  });
});

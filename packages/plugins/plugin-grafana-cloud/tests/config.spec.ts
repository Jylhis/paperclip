import { describe, expect, it } from "vitest";
import { mergeConfig, parseInstanceConfig } from "../src/config.js";

describe("parseInstanceConfig", () => {
  it("parses a valid config block", () => {
    const cfg = parseInstanceConfig({
      defaults: {
        stackSlug: "x",
        region: "r",
        cloudAccessTokenRef: "c",
        stackTokenRef: "s",
      },
    });
    expect(cfg.defaults.stackSlug).toBe("x");
  });

  it("throws on missing required fields", () => {
    expect(() =>
      parseInstanceConfig({ defaults: { stackSlug: "x", region: "r" } }),
    ).toThrow(/missing required fields/);
  });

  it("throws on null", () => {
    expect(() => parseInstanceConfig(null)).toThrow(/missing/);
  });
});

describe("mergeConfig", () => {
  const defaults = {
    stackSlug: "d-slug",
    region: "d-region",
    cloudAccessTokenRef: "d-cloud",
    stackTokenRef: "d-stack",
    timeoutMs: 10_000,
    httpRetryCount: 1,
  };

  it("returns defaults when override is null", () => {
    expect(mergeConfig(defaults, null)).toMatchObject({
      stackSlug: "d-slug",
      region: "d-region",
      cloudAccessTokenRef: "d-cloud",
      stackTokenRef: "d-stack",
      timeoutMs: 10_000,
      httpRetryCount: 1,
    });
  });

  it("override wins per field", () => {
    const merged = mergeConfig(defaults, { stackSlug: "o-slug", cloudAccessTokenRef: "o-cloud" });
    expect(merged.stackSlug).toBe("o-slug");
    expect(merged.region).toBe("d-region");
    expect(merged.cloudAccessTokenRef).toBe("o-cloud");
    expect(merged.stackTokenRef).toBe("d-stack");
  });

  it("supplies sensible defaults when timeout/retry omitted everywhere", () => {
    const noTimeoutDefaults = { ...defaults, timeoutMs: undefined, httpRetryCount: undefined };
    const merged = mergeConfig(noTimeoutDefaults, null);
    expect(merged.timeoutMs).toBe(30_000);
    expect(merged.httpRetryCount).toBe(2);
  });
});

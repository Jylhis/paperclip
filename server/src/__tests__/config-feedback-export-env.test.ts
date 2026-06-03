import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

const KEYS = [
  "PAPERCLIP_FEEDBACK_EXPORT_BACKEND_URL",
  "PAPERCLIP_FEEDBACK_EXPORT_BACKEND_TOKEN",
  "PAPERCLIP_TELEMETRY_BACKEND_URL",
  "PAPERCLIP_TELEMETRY_BACKEND_TOKEN",
] as const;

const originalValues = new Map<string, string | undefined>(
  KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of KEYS) {
    const original = originalValues.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe("loadConfig feedback export backend env resolution", () => {
  it("uses feedback export backend env vars when set", () => {
    process.env.PAPERCLIP_FEEDBACK_EXPORT_BACKEND_URL = "https://feedback.example.test";
    process.env.PAPERCLIP_FEEDBACK_EXPORT_BACKEND_TOKEN = "new-token";
    process.env.PAPERCLIP_TELEMETRY_BACKEND_URL = "https://legacy.example.test";
    process.env.PAPERCLIP_TELEMETRY_BACKEND_TOKEN = "legacy-token";

    const config = loadConfig();

    expect(config.feedbackExportBackendUrl).toBe("https://feedback.example.test");
    expect(config.feedbackExportBackendToken).toBe("new-token");
  });

  it("falls back to legacy telemetry backend env vars for feedback export", () => {
    delete process.env.PAPERCLIP_FEEDBACK_EXPORT_BACKEND_URL;
    delete process.env.PAPERCLIP_FEEDBACK_EXPORT_BACKEND_TOKEN;
    process.env.PAPERCLIP_TELEMETRY_BACKEND_URL = "https://legacy.example.test";
    process.env.PAPERCLIP_TELEMETRY_BACKEND_TOKEN = "legacy-token";

    const config = loadConfig();

    expect(config.feedbackExportBackendUrl).toBe("https://legacy.example.test");
    expect(config.feedbackExportBackendToken).toBe("legacy-token");
  });
});

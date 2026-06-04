import { describe, expect, it } from "vitest";
import {
  ADAPTER_SESSION_MANAGEMENT,
  LEGACY_SESSIONED_ADAPTER_TYPES,
  getAdapterSessionManagement,
  resolveSessionCompactionPolicy,
} from "./session-compaction.js";

describe("grok_local session registry", () => {
  it("LEGACY_SESSIONED_ADAPTER_TYPES includes grok_local", () => {
    expect(LEGACY_SESSIONED_ADAPTER_TYPES.has("grok_local")).toBe(true);
  });

  it("ADAPTER_SESSION_MANAGEMENT has a grok_local entry", () => {
    expect(ADAPTER_SESSION_MANAGEMENT).toHaveProperty("grok_local");
  });

  it("getAdapterSessionManagement returns session management config for grok_local", () => {
    const mgmt = getAdapterSessionManagement("grok_local");
    expect(mgmt).not.toBeNull();
    expect(mgmt?.supportsSessionResume).toBe(true);
    expect(mgmt?.nativeContextManagement).toBe("unknown");
    expect(mgmt?.defaultSessionCompaction.enabled).toBe(true);
  });

  it("resolveSessionCompactionPolicy uses adapter_default source for grok_local", () => {
    const result = resolveSessionCompactionPolicy("grok_local", {});
    expect(result.source).toBe("adapter_default");
    expect(result.policy.enabled).toBe(true);
    expect(result.adapterSessionManagement).not.toBeNull();
  });

  it("resolveSessionCompactionPolicy did not fall back to legacy_fallback before fix", () => {
    // Regression: without the ADAPTER_SESSION_MANAGEMENT entry, grok_local would resolve
    // via LEGACY_SESSIONED_ADAPTER_TYPES as "legacy_fallback". After the fix, it uses
    // the explicit entry and reports "adapter_default".
    const result = resolveSessionCompactionPolicy("grok_local", {});
    expect(result.source).not.toBe("legacy_fallback");
  });
});

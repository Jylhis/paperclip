import { describe, expect, it } from "vitest";
import {
  extractClaudeRetryNotBefore,
  isClaudeQuotaOrBillingError,
  isClaudeTransientUpstreamError,
  summarizeClaudeProbeFailureDetail,
} from "./parse.js";

describe("isClaudeTransientUpstreamError", () => {
  it("classifies the 'out of extra usage' subscription window failure as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "You're out of extra usage · resets 4pm (America/Chicago)",
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          result: "You're out of extra usage. Resets at 4pm (America/Chicago).",
        },
      }),
    ).toBe(true);
  });

  it("classifies Anthropic API rate_limit_error and overloaded_error as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          errors: [{ type: "rate_limit_error", message: "Rate limit reached for requests." }],
        },
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          errors: [{ type: "overloaded_error", message: "Overloaded" }],
        },
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        stderr: "HTTP 429: Too Many Requests",
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        stderr: "Bedrock ThrottlingException: slow down",
      }),
    ).toBe(true);
  });

  it("classifies the subscription 5-hour / weekly limit wording", () => {
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "Claude usage limit reached — weekly limit reached. Try again in 2 days.",
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "5-hour limit reached.",
      }),
    ).toBe(true);
  });

  it("does not classify login/auth failures as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        stderr: "Please log in. Run `claude login` first.",
      }),
    ).toBe(false);
  });

  it("does not classify max-turns or unknown-session as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: { subtype: "error_max_turns", result: "Maximum turns reached." },
      }),
    ).toBe(false);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          result: "No conversation found with session id abc-123",
          errors: [{ message: "No conversation found with session id abc-123" }],
        },
      }),
    ).toBe(false);
  });

  it("does not classify deterministic validation errors as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "Invalid request_error: Unknown parameter 'foo'.",
      }),
    ).toBe(false);
  });
});

describe("extractClaudeRetryNotBefore", () => {
  it("parses the 'resets 4pm' hint in its explicit timezone", () => {
    const now = new Date("2026-04-22T15:15:00.000Z");
    const extracted = extractClaudeRetryNotBefore(
      { errorMessage: "You're out of extra usage · resets 4pm (America/Chicago)" },
      now,
    );
    expect(extracted?.toISOString()).toBe("2026-04-22T21:00:00.000Z");
  });

  it("rolls forward past midnight when the reset time has already passed today", () => {
    const now = new Date("2026-04-22T23:30:00.000Z");
    const extracted = extractClaudeRetryNotBefore(
      { errorMessage: "Usage limit reached. Resets at 3:15 AM (UTC)." },
      now,
    );
    expect(extracted?.toISOString()).toBe("2026-04-23T03:15:00.000Z");
  });

  it("returns null when no reset hint is present", () => {
    expect(
      extractClaudeRetryNotBefore({ errorMessage: "Overloaded. Try again later." }, new Date()),
    ).toBeNull();
  });
});

describe("isClaudeQuotaOrBillingError", () => {
  it("detects a low credit balance from the stream-json result text", () => {
    const parsed = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result:
        "Your credit balance is too low to access the Claude API. Please go to Plans & Billing to upgrade or purchase credits.",
    };
    expect(isClaudeQuotaOrBillingError({ parsed })).toBe(true);
  });

  it("detects quota exhaustion from stderr", () => {
    expect(
      isClaudeQuotaOrBillingError({ stderr: "API Error: 400 exceeded your current quota" }),
    ).toBe(true);
  });

  it("does not flag ordinary login/auth failures", () => {
    expect(isClaudeQuotaOrBillingError({ stderr: "Invalid API key. Please log in." })).toBe(false);
  });

  it("returns false when there is no output", () => {
    expect(isClaudeQuotaOrBillingError({})).toBe(false);
  });
});

describe("summarizeClaudeProbeFailureDetail", () => {
  it("prefers the structured result text over raw output lines", () => {
    const detail = summarizeClaudeProbeFailureDetail({
      parsed: { type: "result", is_error: true, result: "Credit balance is too low." },
      summary: "Credit balance is too low.",
      stdout: '{"type":"system","subtype":"init"}',
      stderr: "",
    });
    expect(detail).toBe("Credit balance is too low.");
  });

  it("falls back to the first stderr line when no structured text exists", () => {
    const detail = summarizeClaudeProbeFailureDetail({
      parsed: null,
      summary: "",
      stdout: "",
      stderr: "\nAPI Error: 401 unauthorized\n",
    });
    expect(detail).toBe("API Error: 401 unauthorized");
  });

  it("returns null when there is nothing to summarize", () => {
    expect(
      summarizeClaudeProbeFailureDetail({ parsed: null, summary: "", stdout: "", stderr: "" }),
    ).toBeNull();
  });
});

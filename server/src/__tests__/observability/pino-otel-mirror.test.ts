import { beforeEach, describe, expect, it, vi } from "vitest";

const emit = vi.fn();

vi.mock("@opentelemetry/api-logs", () => ({
  SeverityNumber: {
    TRACE: 1,
    DEBUG: 5,
    INFO: 9,
    WARN: 13,
    ERROR: 17,
    FATAL: 21,
  },
  logs: {
    getLogger: () => ({ emit }),
  },
}));

import { createOtelLogMirror } from "../../observability/pino-otel-mirror.js";

describe("createOtelLogMirror", () => {
  beforeEach(() => {
    emit.mockReset();
  });

  it("redacts sensitive keys in mirrored attributes", () => {
    const hook = createOtelLogMirror({ loggerName: "test" });
    const method = vi.fn();

    hook.call({ level: 30 }, [{
      req: { headers: { authorization: "Bearer secret", cookie: "sid=abc" } },
      reqBody: { password: "pw", nested: { apiKey: "k" } },
      safe: "ok",
    }, "request failed"], method, 50);

    const record = emit.mock.calls[0]?.[0];
    expect(record.attributes.safe).toBe("ok");
    expect(record.attributes.req).toContain("[Redacted]");
    expect(record.attributes.reqBody).toContain("[Redacted]");
    expect(record.attributes.req).not.toContain("Bearer secret");
    expect(record.attributes.reqBody).not.toContain("\"pw\"");
    expect(record.attributes.reqBody).not.toContain("\"k\"");
    expect(method).toHaveBeenCalledOnce();
  });
});

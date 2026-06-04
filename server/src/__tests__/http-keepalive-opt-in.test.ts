import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLongKeepAliveTimeouts } from "../index.js";

describe("PAPERCLIP_HTTP_LONG_KEEPALIVE", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets 185 s keepAliveTimeout and 186 s headersTimeout when opt-in env var is true", () => {
    vi.stubEnv("PAPERCLIP_HTTP_LONG_KEEPALIVE", "true");
    const server = createServer();
    applyLongKeepAliveTimeouts(server);
    expect(server.keepAliveTimeout).toBe(185000);
    expect(server.headersTimeout).toBe(186000);
    server.close();
  });

  it("leaves timeouts at Node defaults when env var is absent", () => {
    vi.stubEnv("PAPERCLIP_HTTP_LONG_KEEPALIVE", "");
    const server = createServer();
    const defaultKeepAlive = server.keepAliveTimeout;
    const defaultHeaders = server.headersTimeout;
    applyLongKeepAliveTimeouts(server);
    expect(server.keepAliveTimeout).toBe(defaultKeepAlive);
    expect(server.headersTimeout).toBe(defaultHeaders);
    server.close();
  });

  it("leaves timeouts unchanged for non-true values like '1' or 'yes'", () => {
    vi.stubEnv("PAPERCLIP_HTTP_LONG_KEEPALIVE", "1");
    const server = createServer();
    const defaultKeepAlive = server.keepAliveTimeout;
    applyLongKeepAliveTimeouts(server);
    expect(server.keepAliveTimeout).toBe(defaultKeepAlive);
    server.close();
  });
});

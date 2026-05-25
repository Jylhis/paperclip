import type { PluginContext } from "@paperclipai/plugin-sdk";

export interface UpstreamRequest {
  ctx: PluginContext;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  baseUrl: string;
  path: string;
  token: string;
  /**
   * When provided, use HTTP Basic auth with this username (typical for OTLP
   * gateway or the Mimir tenant header). When omitted, use Bearer auth.
   */
  basicUser?: string;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retryCount?: number;
  /** When true, expect a JSON response. When false, return text. */
  expectJson?: boolean;
  /** Accept header override; defaults to application/json when expectJson is true. */
  accept?: string;
}

export interface UpstreamResponse<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
  rawText?: string;
}

export class UpstreamError extends Error {
  status: number;
  body: unknown;
  url: string;
  constructor(input: { url: string; status: number; statusText: string; body: unknown }) {
    super(`Grafana Cloud upstream error ${input.status} ${input.statusText} for ${input.url}`);
    this.status = input.status;
    this.body = input.body;
    this.url = input.url;
  }
}

/**
 * Shared HTTP wrapper for all Grafana Cloud API calls. Adds:
 *   - Bearer or Basic Authorization header
 *   - JSON request/response handling
 *   - Bounded retries on 5xx and transient network errors
 *   - A request timeout via AbortSignal
 *
 * Errors with a 4xx/5xx are surfaced as UpstreamError so tool handlers can
 * convert them to `ToolResult { error: ... }` shape uniformly.
 */
export async function upstream<T = unknown>(input: UpstreamRequest): Promise<UpstreamResponse<T>> {
  const method = input.method ?? "GET";
  const expectJson = input.expectJson ?? true;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const maxAttempts = (input.retryCount ?? 2) + 1;
  const url = buildUrl(input.baseUrl, input.path, input.query);

  const auth = input.basicUser
    ? `Basic ${Buffer.from(`${input.basicUser}:${input.token}`).toString("base64")}`
    : `Bearer ${input.token}`;

  const headers: Record<string, string> = {
    Authorization: auth,
    Accept: input.accept ?? (expectJson ? "application/json" : "*/*"),
    ...(input.headers ?? {}),
  };
  let body: BodyInit | undefined;
  if (input.body !== undefined && input.body !== null) {
    if (typeof input.body === "string") {
      body = input.body;
      headers["Content-Type"] ??= "text/plain";
    } else {
      body = JSON.stringify(input.body);
      headers["Content-Type"] ??= "application/json";
    }
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await input.ctx.http.fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status >= 500 && attempt < maxAttempts) {
        // Retry server errors with exponential backoff.
        await sleep(150 * attempt * attempt);
        continue;
      }

      const rawText = await res.text();
      const parsed: unknown = expectJson && rawText ? safeJsonParse(rawText) : rawText;
      if (!res.ok) {
        throw new UpstreamError({
          url,
          status: res.status,
          statusText: res.statusText,
          body: parsed,
        });
      }
      return { status: res.status, ok: true, body: parsed as T, rawText };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (err instanceof UpstreamError) throw err;
      if (attempt < maxAttempts) {
        await sleep(150 * attempt * attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`unknown upstream failure for ${url}`);
}

function buildUrl(
  base: string,
  path: string,
  query: UpstreamRequest["query"],
): string {
  const url = new URL(path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

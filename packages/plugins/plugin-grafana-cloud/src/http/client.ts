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

type AttemptOutcome<T> =
  | { kind: "ok"; response: UpstreamResponse<T> }
  | { kind: "retry" }
  | { kind: "error"; error: unknown };

interface AttemptInput {
  ctx: PluginContext;
  url: string;
  method: NonNullable<UpstreamRequest["method"]>;
  headers: Record<string, string>;
  body: BodyInit | undefined;
  timeoutMs: number;
  expectJson: boolean;
  isLastAttempt: boolean;
}

/**
 * Execute a single HTTP attempt. The caller (`upstream`) owns the retry loop;
 * this helper just runs one round-trip, parses the body, and tells the caller
 * whether it should retry (5xx + budget remaining) or stop.
 */
async function attemptOnce<T>(input: AttemptInput): Promise<AttemptOutcome<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const res = await input.ctx.http.fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: controller.signal,
    });

    if (res.status >= 500 && !input.isLastAttempt) {
      return { kind: "retry" };
    }

    // Keep the timer armed across `res.text()` — an upstream that sends
    // headers but stalls the body would otherwise hang forever.
    const rawText = await res.text();
    const parsed: unknown = input.expectJson && rawText ? safeJsonParse(rawText) : rawText;
    if (!res.ok) {
      throw new UpstreamError({
        url: input.url,
        status: res.status,
        statusText: res.statusText,
        body: parsed,
      });
    }
    return { kind: "ok", response: { status: res.status, ok: true, body: parsed as T, rawText } };
  } catch (err) {
    return { kind: "error", error: err };
  } finally {
    clearTimeout(timer);
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
  const headers = buildHeaders(input, expectJson);
  const body = encodeBody(input.body, headers);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await attemptOnce<T>({
      ctx: input.ctx,
      url,
      method,
      headers,
      body,
      timeoutMs,
      expectJson,
      isLastAttempt: attempt === maxAttempts,
    });

    if (outcome.kind === "ok") return outcome.response;

    if (outcome.kind === "error") {
      if (outcome.error instanceof UpstreamError) throw outcome.error;
      lastError = outcome.error;
    }

    if (attempt < maxAttempts) {
      await sleep(150 * attempt * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`unknown upstream failure for ${url}`);
}

function buildHeaders(input: UpstreamRequest, expectJson: boolean): Record<string, string> {
  const credentials = `${input.basicUser}:${input.token}`;
  const auth = input.basicUser
    ? `Basic ${Buffer.from(credentials).toString("base64")}`
    : `Bearer ${input.token}`;
  return {
    Authorization: auth,
    Accept: input.accept ?? (expectJson ? "application/json" : "*/*"),
    ...input.headers,
  };
}

function encodeBody(
  raw: unknown,
  headers: Record<string, string>,
): BodyInit | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") {
    headers["Content-Type"] ??= "text/plain";
    return raw;
  }
  headers["Content-Type"] ??= "application/json";
  return JSON.stringify(raw);
}

function resolveBase(base: string, path: string): string {
  if (path.startsWith("http")) return path;
  const sep = path.startsWith("/") ? "" : "/";
  return `${base}${sep}${path}`;
}

function appendQueryParams(url: URL, query: NonNullable<UpstreamRequest["query"]>): void {
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }
}

function buildUrl(
  base: string,
  path: string,
  query: UpstreamRequest["query"],
): string {
  const url = new URL(resolveBase(base, path));
  if (query) appendQueryParams(url, query);
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

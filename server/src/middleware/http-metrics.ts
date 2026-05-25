import type { RequestHandler } from "express";
import { paperclipMetrics } from "../observability/index.js";

/**
 * Express middleware that records request count and duration per route +
 * status into the OTel meter. Sits next to `httpLogger` and shares its
 * lifecycle — install once at the top of the middleware chain.
 *
 * Route templates (e.g. `/api/issues/:id`) are used when available so the
 * cardinality stays bounded. Unmatched requests (404s, middleware-rejected,
 * scanner traffic) are bucketed under the literal `"unknown"` label to keep
 * the cardinality bounded — using `req.path` here would let arbitrary
 * untrusted URLs blow up the metric series count.
 */
export const httpMetrics: RequestHandler = (req, res, next) => {
  const startNs = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
    const route = (req as { route?: { path?: string } }).route?.path ?? "unknown";
    const attrs = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    const m = paperclipMetrics();
    m.httpServerRequestsTotal.add(1, attrs);
    m.httpServerRequestDurationMs.record(durationMs, attrs);
  });
  next();
};

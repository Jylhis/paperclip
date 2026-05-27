import type { PluginContext, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import { mergeConfig, type CompanyOverride, type InstanceConfigShape } from "../config.js";
import { resolveStackEndpoints, type ResolvedStack } from "../stack-resolver.js";
import { upstream, UpstreamError } from "../http/client.js";
import { validateToolParams } from "../tool-params.js";

export interface ToolContext {
  ctx: PluginContext;
  runCtx: ToolRunContext;
  stack: ResolvedStack;
  /** Resolved stack-scoped service-account token (Bearer). */
  stackToken: string;
  /** Resolved grafana.com Cloud Access Policy token (Bearer). */
  cloudAccessToken: string;
  /** The token used by Mimir/Loki/Tempo Basic-auth flow. Same as stackToken. */
  basicUserMimir: string;
  basicUserLoki: string;
  basicUserTempo: string;
  basicUserPyroscope: string;
}

type ToolHandler = (params: Record<string, unknown>, tctx: ToolContext) => Promise<ToolResult>;

/** Lookup table of tool name → handler. Populated by registerHandlers(). */
const handlers = new Map<string, ToolHandler>();

function reg(name: string, handler: ToolHandler) {
  handlers.set(name, handler);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown, summary?: string): ToolResult {
  return {
    content: summary ?? defaultSummary(data),
    data,
  };
}

function defaultSummary(data: unknown): string {
  if (Array.isArray(data)) return `${data.length} items`;
  if (data && typeof data === "object") return JSON.stringify(data).slice(0, 500);
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data === "number" || typeof data === "boolean" || typeof data === "bigint") {
    return data.toString();
  }
  // Symbol / function — uncommon shapes, but avoid default object-toString.
  return Object.prototype.toString.call(data);
}

function paramStr(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function paramNum(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function paramArray(params: Record<string, unknown>, key: string): string[] | undefined {
  const v = params[key];
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const strs = v.filter((x): x is string => typeof x === "string");
  return strs.length > 0 ? strs : undefined;
}

async function getJson<T>(
  tctx: ToolContext,
  baseUrl: string,
  path: string,
  opts: {
    token?: string;
    basicUser?: string;
    query?: Record<string, unknown>;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
): Promise<T> {
  if (!baseUrl) {
    throw new Error("missing base URL — stack lookup did not return this endpoint");
  }
  const res = await upstream<T>({
    ctx: tctx.ctx,
    method: opts.method ?? "GET",
    baseUrl,
    path,
    token: opts.token ?? tctx.stackToken,
    basicUser: opts.basicUser,
    query: opts.query as Record<string, string | number | boolean | string[] | undefined>,
    body: opts.body,
  });
  return res.body;
}

// ---------------------------------------------------------------------------
// cloud_* — grafana.com Cloud Admin (api.grafana.com)
// ---------------------------------------------------------------------------

const GRAFANA_COM = "https://grafana.com/api";

reg("cloud_list_stacks", async (_p, t) => {
  const data = await getJson(t, GRAFANA_COM, "/instances", { token: t.cloudAccessToken });
  return ok(data);
});
reg("cloud_get_stack", async (p, t) => {
  const slug = paramStr(p, "stackSlug") ?? t.stack.slug;
  const data = await getJson(t, GRAFANA_COM, `/instances/${encodeURIComponent(slug)}`, {
    token: t.cloudAccessToken,
  });
  return ok(data);
});
reg("cloud_list_orgs", async (_p, t) => {
  const data = await getJson(t, GRAFANA_COM, "/orgs", { token: t.cloudAccessToken });
  return ok(data);
});
reg("cloud_list_access_policies", async (_p, t) => {
  const data = await getJson(t, GRAFANA_COM, "/v1/accesspolicies", { token: t.cloudAccessToken });
  return ok(data);
});
reg("cloud_get_access_policy", async (p, t) => {
  const id = paramStr(p, "policyId") ?? "";
  const data = await getJson(t, GRAFANA_COM, `/v1/accesspolicies/${encodeURIComponent(id)}`, {
    token: t.cloudAccessToken,
  });
  return ok(data);
});
reg("cloud_list_tokens", async (p, t) => {
  const id = paramStr(p, "policyId") ?? "";
  const path = id
    ? `/v1/tokens?accessPolicyId=${encodeURIComponent(id)}`
    : "/v1/tokens";
  const data = await getJson(t, GRAFANA_COM, path, { token: t.cloudAccessToken });
  return ok(data);
});

// ---------------------------------------------------------------------------
// grafana_* — stack-scoped Grafana core (dashboards, alerts, etc.)
// ---------------------------------------------------------------------------

reg("grafana_search", async (p, t) => {
  const data = await getJson(t, t.stack.grafanaUrl, "/api/search", {
    query: { query: paramStr(p, "query"), type: paramStr(p, "type"), limit: paramNum(p, "limit") },
  });
  return ok(data);
});
reg("grafana_list_dashboards", async (p, t) => {
  const data = await getJson(t, t.stack.grafanaUrl, "/api/search", {
    query: {
      type: "dash-db",
      folderUIDs: paramStr(p, "folderUid"),
      limit: paramNum(p, "limit"),
    },
  });
  return ok(data);
});
reg("grafana_get_dashboard_by_uid", async (p, t) => {
  const uid = paramStr(p, "uid") ?? "";
  const data = await getJson(t, t.stack.grafanaUrl, `/api/dashboards/uid/${encodeURIComponent(uid)}`);
  return ok(data);
});
reg("grafana_get_dashboard_versions", async (p, t) => {
  const uid = paramStr(p, "uid") ?? "";
  const data = await getJson(
    t,
    t.stack.grafanaUrl,
    `/api/dashboards/uid/${encodeURIComponent(uid)}/versions`,
  );
  return ok(data);
});
reg("grafana_list_folders", async (_p, t) => ok(await getJson(t, t.stack.grafanaUrl, "/api/folders")));
reg("grafana_get_folder", async (p, t) => {
  const uid = paramStr(p, "uid") ?? "";
  return ok(await getJson(t, t.stack.grafanaUrl, `/api/folders/${encodeURIComponent(uid)}`));
});
reg("grafana_list_datasources", async (_p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/datasources")));
reg("grafana_get_datasource_by_uid", async (p, t) => {
  const uid = paramStr(p, "uid") ?? "";
  return ok(await getJson(t, t.stack.grafanaUrl, `/api/datasources/uid/${encodeURIComponent(uid)}`));
});
reg("grafana_test_datasource", async (p, t) => {
  const uid = paramStr(p, "uid") ?? "";
  // Grafana exposes per-data-source health checks at /api/datasources/uid/<uid>/health
  return ok(
    await getJson(t, t.stack.grafanaUrl, `/api/datasources/uid/${encodeURIComponent(uid)}/health`),
  );
});
reg("grafana_list_alert_rules", async (p, t) => {
  const query: Record<string, unknown> = {};
  const folderUid = paramStr(p, "folderUid");
  if (folderUid) query.folderUid = folderUid;
  return ok(await getJson(t, t.stack.grafanaUrl, "/api/v1/provisioning/alert-rules", { query }));
});
reg("grafana_get_alert_rule", async (p, t) => {
  const uid = paramStr(p, "uid") ?? "";
  return ok(
    await getJson(t, t.stack.grafanaUrl, `/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`),
  );
});
reg("grafana_get_alert_rule_state", async (p, t) => {
  const uid = paramStr(p, "uid") ?? "";
  return ok(await getJson(t, t.stack.grafanaUrl, `/api/prometheus/grafana/api/v1/rules`, {
    query: { rule_uid: uid },
  }));
});
reg("grafana_list_contact_points", async (_p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/v1/provisioning/contact-points")));
reg("grafana_list_notification_policies", async (_p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/v1/provisioning/policies")));
reg("grafana_list_mute_timings", async (_p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/v1/provisioning/mute-timings")));
reg("grafana_list_silences", async (p, t) => {
  const data = await getJson(t, t.stack.grafanaUrl, "/api/alertmanager/grafana/api/v2/silences", {
    query: { state: paramStr(p, "state") },
  });
  return ok(data);
});
reg("grafana_create_silence", async (p, t) => {
  const data = await getJson(t, t.stack.grafanaUrl, "/api/alertmanager/grafana/api/v2/silences", {
    method: "POST",
    body: {
      matchers: p.matchers,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      comment: p.comment,
      createdBy: p.createdBy ?? "paperclip-agent",
    },
  });
  return ok(data, "silence created");
});
reg("grafana_expire_silence", async (p, t) => {
  const id = paramStr(p, "silenceId") ?? "";
  await getJson(t, t.stack.grafanaUrl, `/api/alertmanager/grafana/api/v2/silence/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return ok({ id, status: "expired" }, "silence expired");
});
reg("grafana_list_annotations", async (p, t) => {
  return ok(await getJson(t, t.stack.grafanaUrl, "/api/annotations", {
    query: {
      from: paramNum(p, "from"),
      to: paramNum(p, "to"),
      dashboardUID: paramStr(p, "dashboardUid"),
      // Grafana's /api/annotations accepts repeated ?tags=foo&tags=bar — pass
      // the array through so the upstream client encodes one param per tag.
      tags: paramArray(p, "tags"),
    },
  }));
});
reg("grafana_create_annotation", async (p, t) => {
  return ok(await getJson(t, t.stack.grafanaUrl, "/api/annotations", {
    method: "POST",
    body: {
      time: p.time,
      timeEnd: p.timeEnd,
      tags: p.tags,
      text: p.text,
      dashboardUID: p.dashboardUid,
      panelId: p.panelId,
    },
  }));
});
reg("grafana_list_teams", async (_p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/teams/search")));
reg("grafana_list_team_members", async (p, t) => {
  const id = paramNum(p, "teamId") ?? 0;
  return ok(await getJson(t, t.stack.grafanaUrl, `/api/teams/${id}/members`));
});
reg("grafana_list_users", async (_p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/org/users")));
reg("grafana_get_user", async (p, t) => {
  const id = paramNum(p, "userId") ?? 0;
  return ok(await getJson(t, t.stack.grafanaUrl, `/api/users/${id}`));
});
reg("grafana_list_service_accounts", async (_p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/serviceaccounts/search")));
reg("grafana_list_library_panels", async (_p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/library-elements")));

// ---------------------------------------------------------------------------
// loki_* — logs
// Loki on Grafana Cloud uses Basic auth: user = instanceId, password = token.
// ---------------------------------------------------------------------------

const LOKI_BASE = "/loki/api/v1";

reg("loki_query", async (p, t) =>
  ok(await getJson(t, t.stack.lokiUrl, `${LOKI_BASE}/query`, {
    basicUser: t.basicUserLoki,
    query: { query: paramStr(p, "query"), time: paramStr(p, "time"), limit: paramNum(p, "limit") },
  })));
reg("loki_query_range", async (p, t) =>
  ok(await getJson(t, t.stack.lokiUrl, `${LOKI_BASE}/query_range`, {
    basicUser: t.basicUserLoki,
    query: {
      query: paramStr(p, "query"),
      start: paramStr(p, "start"),
      end: paramStr(p, "end"),
      step: paramStr(p, "step"),
      limit: paramNum(p, "limit"),
      direction: paramStr(p, "direction"),
    },
  })));
reg("loki_labels", async (p, t) =>
  ok(await getJson(t, t.stack.lokiUrl, `${LOKI_BASE}/labels`, {
    basicUser: t.basicUserLoki,
    query: { start: paramStr(p, "start"), end: paramStr(p, "end") },
  })));
reg("loki_label_values", async (p, t) =>
  ok(await getJson(t, t.stack.lokiUrl, `${LOKI_BASE}/label/${encodeURIComponent(paramStr(p, "label") ?? "")}/values`, {
    basicUser: t.basicUserLoki,
    query: { start: paramStr(p, "start"), end: paramStr(p, "end") },
  })));
reg("loki_series", async (p, t) =>
  ok(await getJson(t, t.stack.lokiUrl, `${LOKI_BASE}/series`, {
    basicUser: t.basicUserLoki,
    query: {
      "match[]": paramArray(p, "match"),
      start: paramStr(p, "start"),
      end: paramStr(p, "end"),
    },
  })));
reg("loki_tail_recent", async (p, t) => {
  const lookback = paramNum(p, "lookbackSeconds") ?? 300;
  const end = new Date().toISOString();
  const start = new Date(Date.now() - lookback * 1000).toISOString();
  return ok(await getJson(t, t.stack.lokiUrl, `${LOKI_BASE}/query_range`, {
    basicUser: t.basicUserLoki,
    query: {
      query: paramStr(p, "query"),
      start,
      end,
      limit: paramNum(p, "limit") ?? 100,
      direction: "backward",
    },
  }));
});
reg("loki_list_rules", async (_p, t) =>
  ok(await getJson(t, t.stack.lokiUrl, "/api/prom/rules", { basicUser: t.basicUserLoki })));

// ---------------------------------------------------------------------------
// tempo_* — traces
// ---------------------------------------------------------------------------

reg("tempo_search_traces", async (p, t) =>
  ok(await getJson(t, t.stack.tempoUrl, "/api/search", {
    basicUser: t.basicUserTempo,
    query: {
      tags: paramStr(p, "tags"),
      minDuration: paramStr(p, "minDuration"),
      maxDuration: paramStr(p, "maxDuration"),
      start: paramNum(p, "start"),
      end: paramNum(p, "end"),
      limit: paramNum(p, "limit"),
    },
  })));
reg("tempo_get_trace", async (p, t) => {
  const id = paramStr(p, "traceId") ?? "";
  return ok(await getJson(t, t.stack.tempoUrl, `/api/traces/${encodeURIComponent(id)}`, {
    basicUser: t.basicUserTempo,
  }));
});
reg("tempo_search_tag_names", async (_p, t) =>
  ok(await getJson(t, t.stack.tempoUrl, "/api/search/tags", { basicUser: t.basicUserTempo })));
reg("tempo_search_tag_values", async (p, t) => {
  const tag = paramStr(p, "tag") ?? "";
  return ok(await getJson(t, t.stack.tempoUrl, `/api/search/tag/${encodeURIComponent(tag)}/values`, {
    basicUser: t.basicUserTempo,
  }));
});
reg("tempo_query_metrics", async (p, t) =>
  ok(await getJson(t, t.stack.tempoUrl, "/api/metrics/query_range", {
    basicUser: t.basicUserTempo,
    query: {
      q: paramStr(p, "q"),
      start: paramNum(p, "start"),
      end: paramNum(p, "end"),
      step: paramStr(p, "step"),
    },
  })));

// ---------------------------------------------------------------------------
// mimir_* + prom_* aliases — metrics
// ---------------------------------------------------------------------------

const MIMIR_BASE = "/api/prom/api/v1";

async function mimirQuery(t: ToolContext, query: string | undefined, time?: string) {
  return getJson(t, t.stack.mimirPromUrl, `${MIMIR_BASE}/query`, {
    basicUser: t.basicUserMimir,
    query: { query, time },
  });
}
async function mimirQueryRange(
  t: ToolContext,
  query: string | undefined,
  start?: string,
  end?: string,
  step?: string,
) {
  return getJson(t, t.stack.mimirPromUrl, `${MIMIR_BASE}/query_range`, {
    basicUser: t.basicUserMimir,
    query: { query, start, end, step },
  });
}

reg("mimir_query", async (p, t) => ok(await mimirQuery(t, paramStr(p, "query"), paramStr(p, "time"))));
reg("mimir_query_range", async (p, t) =>
  ok(await mimirQueryRange(t, paramStr(p, "query"), paramStr(p, "start"), paramStr(p, "end"), paramStr(p, "step"))));
reg("mimir_labels", async (p, t) =>
  ok(await getJson(t, t.stack.mimirPromUrl, `${MIMIR_BASE}/labels`, {
    basicUser: t.basicUserMimir,
    query: { start: paramStr(p, "start"), end: paramStr(p, "end") },
  })));
reg("mimir_label_values", async (p, t) => {
  const label = paramStr(p, "label") ?? "";
  return ok(await getJson(t, t.stack.mimirPromUrl, `${MIMIR_BASE}/label/${encodeURIComponent(label)}/values`, {
    basicUser: t.basicUserMimir,
  }));
});
reg("mimir_series", async (p, t) =>
  ok(await getJson(t, t.stack.mimirPromUrl, `${MIMIR_BASE}/series`, {
    basicUser: t.basicUserMimir,
    query: {
      "match[]": paramArray(p, "match"),
      start: paramStr(p, "start"),
      end: paramStr(p, "end"),
    },
  })));
reg("mimir_list_rules", async (_p, t) =>
  ok(await getJson(t, t.stack.mimirPromUrl, "/api/prom/rules", { basicUser: t.basicUserMimir })));
reg("mimir_get_rule_group", async (p, t) => {
  const ns = paramStr(p, "namespace") ?? "";
  const name = paramStr(p, "name") ?? "";
  return ok(await getJson(t, t.stack.mimirPromUrl, `/config/v1/rules/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`, {
    basicUser: t.basicUserMimir,
  }));
});
reg("mimir_list_alertmanager_alerts", async (p, t) =>
  ok(await getJson(t, t.stack.alertmanagerUrl, "/api/v2/alerts", {
    basicUser: t.basicUserMimir,
    query: { active: p.active, silenced: p.silenced },
  })));
reg("mimir_metadata", async (p, t) =>
  ok(await getJson(t, t.stack.mimirPromUrl, `${MIMIR_BASE}/metadata`, {
    basicUser: t.basicUserMimir,
    query: { metric: paramStr(p, "metric"), limit: paramNum(p, "limit") },
  })));
reg("mimir_targets", async (p, t) =>
  ok(await getJson(t, t.stack.mimirPromUrl, `${MIMIR_BASE}/targets`, {
    basicUser: t.basicUserMimir,
    query: { state: paramStr(p, "state") },
  })));

// Aliases routed to the same handlers.
reg("prom_query", async (p, t) => ok(await mimirQuery(t, paramStr(p, "query"), paramStr(p, "time"))));
reg("prom_query_range", async (p, t) =>
  ok(await mimirQueryRange(t, paramStr(p, "query"), paramStr(p, "start"), paramStr(p, "end"), paramStr(p, "step"))));
reg("prom_labels", async (p, t) => (handlers.get("mimir_labels") as ToolHandler)(p, t));
reg("prom_label_values", async (p, t) => (handlers.get("mimir_label_values") as ToolHandler)(p, t));

// ---------------------------------------------------------------------------
// pyroscope_* — profiles
// ---------------------------------------------------------------------------

reg("pyroscope_list_apps", async (_p, t) =>
  ok(await getJson(t, t.stack.pyroscopeUrl, "/querier.v1.QuerierService/LabelValues", {
    basicUser: t.basicUserPyroscope,
    method: "POST",
    body: { name: "__profile_type__" },
  })));
reg("pyroscope_query_profile", async (p, t) =>
  ok(await getJson(t, t.stack.pyroscopeUrl, "/render", {
    basicUser: t.basicUserPyroscope,
    query: {
      query: paramStr(p, "query"),
      from: paramStr(p, "from"),
      until: paramStr(p, "until"),
      format: paramStr(p, "format") ?? "json",
    },
  })));
reg("pyroscope_label_names", async (p, t) =>
  ok(await getJson(t, t.stack.pyroscopeUrl, "/label-names", {
    basicUser: t.basicUserPyroscope,
    query: { start: paramStr(p, "start"), end: paramStr(p, "end") },
  })));
reg("pyroscope_label_values", async (p, t) =>
  ok(await getJson(t, t.stack.pyroscopeUrl, "/label-values", {
    basicUser: t.basicUserPyroscope,
    query: { name: paramStr(p, "label") },
  })));
reg("pyroscope_get_flamegraph", async (p, t) =>
  ok(await getJson(t, t.stack.pyroscopeUrl, "/render", {
    basicUser: t.basicUserPyroscope,
    query: {
      query: paramStr(p, "query"),
      from: paramStr(p, "from"),
      until: paramStr(p, "until"),
      format: "collapsed",
    },
  })));

// ---------------------------------------------------------------------------
// faro_* — frontend RUM
// ---------------------------------------------------------------------------

reg("faro_list_apps", async (_p, t) =>
  ok(await getJson(t, t.stack.faroUrl, "/faro/api/v1/apps")));
reg("faro_get_app", async (p, t) => {
  const id = paramStr(p, "appId") ?? "";
  return ok(await getJson(t, t.stack.faroUrl, `/faro/api/v1/apps/${encodeURIComponent(id)}`));
});
reg("faro_query_measurements", async (p, t) =>
  // Faro measurements live in the bundled Mimir tenant under the faro_ metrics namespace.
  ok(await getJson(t, t.stack.mimirPromUrl, `${MIMIR_BASE}/query_range`, {
    basicUser: t.basicUserMimir,
    query: {
      query: paramStr(p, "query"),
      start: paramStr(p, "start"),
      end: paramStr(p, "end"),
    },
  })));
reg("faro_list_recent_errors", async (p, t) => {
  const lookback = paramNum(p, "lookbackSeconds") ?? 300;
  const end = new Date().toISOString();
  const start = new Date(Date.now() - lookback * 1000).toISOString();
  const appId = paramStr(p, "appId") ?? "";
  const query = `{app="${appId}", kind="exception"}`;
  return ok(await getJson(t, t.stack.lokiUrl, `${LOKI_BASE}/query_range`, {
    basicUser: t.basicUserLoki,
    query: { query, start, end, limit: paramNum(p, "limit") ?? 100, direction: "backward" },
  }));
});

// ---------------------------------------------------------------------------
// sm_* — synthetic monitoring
// ---------------------------------------------------------------------------

reg("sm_list_probes", async (_p, t) =>
  ok(await getJson(t, t.stack.smUrl, "/api/v1/probe/list")));
reg("sm_get_probe", async (p, t) => {
  const id = paramNum(p, "probeId") ?? 0;
  return ok(await getJson(t, t.stack.smUrl, `/api/v1/probe/${id}`));
});
reg("sm_list_checks", async (_p, t) =>
  ok(await getJson(t, t.stack.smUrl, "/api/v1/check/list")));
reg("sm_get_check", async (p, t) => {
  const id = paramNum(p, "checkId") ?? 0;
  return ok(await getJson(t, t.stack.smUrl, `/api/v1/check/${id}`));
});
reg("sm_create_check", async (p, t) =>
  ok(await getJson(t, t.stack.smUrl, "/api/v1/check/add", { method: "POST", body: p.check })));
reg("sm_update_check", async (p, t) => {
  const id = paramNum(p, "checkId") ?? 0;
  return ok(await getJson(t, t.stack.smUrl, `/api/v1/check/update`, { method: "POST", body: { id, ...(p.check as object) } }));
});
reg("sm_delete_check", async (p, t) => {
  const id = paramNum(p, "checkId") ?? 0;
  return ok(await getJson(t, t.stack.smUrl, `/api/v1/check/delete/${id}`, { method: "DELETE" }));
});
reg("sm_list_check_results", async (p, t) => {
  const lookback = paramNum(p, "lookbackSeconds") ?? 600;
  const end = new Date().toISOString();
  const start = new Date(Date.now() - lookback * 1000).toISOString();
  const id = paramNum(p, "checkId") ?? 0;
  const logql = `{check_id="${id}"}`;
  return ok(await getJson(t, t.stack.lokiUrl, `${LOKI_BASE}/query_range`, {
    basicUser: t.basicUserLoki,
    query: { query: logql, start, end, limit: 200, direction: "backward" },
  }));
});
reg("sm_list_tenants", async (_p, t) =>
  ok(await getJson(t, t.stack.smUrl, "/api/v1/tenant/list")));

// ---------------------------------------------------------------------------
// oncall_* — Grafana OnCall
// ---------------------------------------------------------------------------

const ONCALL_BASE = "/oncall/api/v1";

reg("oncall_list_schedules", async (_p, t) =>
  ok(await getJson(t, t.stack.oncallUrl, `${ONCALL_BASE}/schedules`)));
reg("oncall_get_schedule", async (p, t) =>
  ok(await getJson(t, t.stack.oncallUrl, `${ONCALL_BASE}/schedules/${encodeURIComponent(paramStr(p, "scheduleId") ?? "")}`)));
reg("oncall_get_on_call_now", async (p, t) => {
  const scheduleId = paramStr(p, "scheduleId");
  const path = scheduleId
    ? `${ONCALL_BASE}/on_call_shifts?schedule_id=${encodeURIComponent(scheduleId)}`
    : `${ONCALL_BASE}/on_call_shifts`;
  return ok(await getJson(t, t.stack.oncallUrl, path));
});
reg("oncall_list_escalation_chains", async (_p, t) =>
  ok(await getJson(t, t.stack.oncallUrl, `${ONCALL_BASE}/escalation_chains`)));
reg("oncall_get_escalation_chain", async (p, t) =>
  ok(await getJson(t, t.stack.oncallUrl, `${ONCALL_BASE}/escalation_chains/${encodeURIComponent(paramStr(p, "chainId") ?? "")}`)));
reg("oncall_list_alert_groups", async (p, t) =>
  ok(await getJson(t, t.stack.oncallUrl, `${ONCALL_BASE}/alert_groups`, {
    query: { state: paramStr(p, "state") },
  })));
reg("oncall_get_alert_group", async (p, t) =>
  ok(await getJson(t, t.stack.oncallUrl, `${ONCALL_BASE}/alert_groups/${encodeURIComponent(paramStr(p, "alertGroupId") ?? "")}`)));
reg("oncall_ack_alert_group", async (p, t) =>
  ok(await getJson(t, t.stack.oncallUrl, `${ONCALL_BASE}/alert_groups/${encodeURIComponent(paramStr(p, "alertGroupId") ?? "")}/acknowledge`, {
    method: "POST",
  })));
reg("oncall_resolve_alert_group", async (p, t) =>
  ok(await getJson(t, t.stack.oncallUrl, `${ONCALL_BASE}/alert_groups/${encodeURIComponent(paramStr(p, "alertGroupId") ?? "")}/resolve`, {
    method: "POST",
  })));
reg("oncall_list_users", async (_p, t) =>
  ok(await getJson(t, t.stack.oncallUrl, `${ONCALL_BASE}/users`)));
reg("oncall_list_teams", async (_p, t) =>
  ok(await getJson(t, t.stack.oncallUrl, `${ONCALL_BASE}/teams`)));

// ---------------------------------------------------------------------------
// irm_* — Grafana IRM / Incident
// ---------------------------------------------------------------------------

reg("irm_list_incidents", async (p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/plugins/grafana-incident-app/resources/api/IncidentsService.QueryIncidents", {
    method: "POST",
    body: {
      query: {
        status: paramStr(p, "status"),
        severity: paramStr(p, "severity"),
        limit: paramNum(p, "limit") ?? 25,
      },
    },
  })));
reg("irm_get_incident", async (p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/plugins/grafana-incident-app/resources/api/IncidentsService.GetIncident", {
    method: "POST",
    body: { incidentID: paramStr(p, "incidentId") },
  })));
reg("irm_list_incident_activities", async (p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/plugins/grafana-incident-app/resources/api/ActivityService.QueryActivity", {
    method: "POST",
    body: { query: { incidentID: paramStr(p, "incidentId") } },
  })));
reg("irm_list_runbooks", async (_p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/plugins/grafana-irm-app/resources/api/runbooks/list")));
reg("irm_create_incident", async (p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/plugins/grafana-incident-app/resources/api/IncidentsService.CreateIncident", {
    method: "POST",
    body: {
      title: paramStr(p, "title"),
      severity: paramStr(p, "severity") ?? "minor",
      summary: paramStr(p, "summary") ?? "",
    },
  })));
reg("irm_add_incident_note", async (p, t) =>
  ok(await getJson(t, t.stack.grafanaUrl, "/api/plugins/grafana-incident-app/resources/api/ActivityService.AddActivity", {
    method: "POST",
    body: {
      incidentID: paramStr(p, "incidentId"),
      activityKind: "userNote",
      body: paramStr(p, "body") ?? "",
    },
  })));

// ---------------------------------------------------------------------------
// k6_* — k6 Cloud (load testing)
// ---------------------------------------------------------------------------

const K6 = "/loadtests/v4";

reg("k6_list_projects", async (_p, t) =>
  ok(await getJson(t, t.stack.k6Url, `${K6}/projects`)));
reg("k6_list_test_runs", async (p, t) =>
  ok(await getJson(t, t.stack.k6Url, `${K6}/test_runs`, {
    query: { project_id: paramNum(p, "projectId"), page_size: paramNum(p, "limit") ?? 25 },
  })));
reg("k6_get_test_run", async (p, t) =>
  ok(await getJson(t, t.stack.k6Url, `${K6}/test_runs/${paramNum(p, "testRunId") ?? 0}`)));
reg("k6_list_test_run_metrics", async (p, t) =>
  ok(await getJson(t, t.stack.k6Url, `${K6}/test_runs/${paramNum(p, "testRunId") ?? 0}/metrics`)));
reg("k6_list_scripts", async (p, t) =>
  ok(await getJson(t, t.stack.k6Url, `${K6}/scripts`, {
    query: { project_id: paramNum(p, "projectId") },
  })));
reg("k6_get_script", async (p, t) =>
  ok(await getJson(t, t.stack.k6Url, `${K6}/scripts/${paramNum(p, "scriptId") ?? 0}`)));

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function getToolHandler(name: string): ToolHandler | null {
  return handlers.get(name) ?? null;
}

export function registeredToolNames(): string[] {
  return Array.from(handlers.keys());
}

export async function dispatchTool(input: {
  name: string;
  params: unknown;
  ctx: PluginContext;
  runCtx: ToolRunContext;
  instanceConfig: InstanceConfigShape;
  loadCompanyOverride: (companyId: string) => Promise<CompanyOverride | null>;
}): Promise<ToolResult> {
  const handler = getToolHandler(input.name);
  if (!handler) {
    return { error: `unknown tool: ${input.name}` };
  }
  // Carry runCtx.companyId into params before validation so the host-bridge
  // pattern (caller sends `{}`, host injects companyId from the authenticated
  // actor scope) still satisfies the manifest's required-companyId contract.
  const rawParams =
    input.params && typeof input.params === "object" ? (input.params as Record<string, unknown>) : {};
  const paramsForValidation =
    typeof rawParams.companyId === "string" && rawParams.companyId
      ? rawParams
      : { ...rawParams, companyId: input.runCtx.companyId };
  // Enforce the parametersSchema declared in manifest.ts. The dispatcher
  // previously trusted callers to pass well-shaped params, so a missing
  // required field (or e.g. a number where a string was declared) silently
  // became `undefined` in the handler and surfaced as a confusing 5xx
  // downstream.
  const validation = validateToolParams(input.name, paramsForValidation);
  if (!validation.ok) {
    return { error: validation.error ?? `invalid params for ${input.name}` };
  }
  const params = validation.data ?? {};
  const companyId = typeof params.companyId === "string" ? params.companyId : "";
  if (!companyId) {
    return { error: "companyId is required" };
  }

  try {
    const override = await input.loadCompanyOverride(companyId);
    const cfg = mergeConfig(input.instanceConfig.defaults, override);
    const [cloudAccessToken, stackToken] = await Promise.all([
      input.ctx.secrets.resolve(cfg.cloudAccessTokenRef),
      input.ctx.secrets.resolve(cfg.stackTokenRef),
    ]);
    const stack = await resolveStackEndpoints({
      ctx: input.ctx,
      config: cfg,
      runCtx: { ...input.runCtx, companyId },
      cloudAccessToken,
    });
    const tctx: ToolContext = {
      ctx: input.ctx,
      runCtx: { ...input.runCtx, companyId },
      stack,
      stackToken,
      cloudAccessToken,
      basicUserMimir: String(stack.mimirInstanceId),
      basicUserLoki: String(stack.lokiInstanceId),
      basicUserTempo: String(stack.tempoInstanceId),
      basicUserPyroscope: String(stack.pyroscopeInstanceId),
    };
    return await handler(params, tctx);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return {
        error: `upstream ${err.status}: ${err.message}`,
        data: { status: err.status, body: err.body, url: err.url },
      };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

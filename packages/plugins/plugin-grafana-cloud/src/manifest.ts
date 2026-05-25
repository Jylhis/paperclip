import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclipai.plugin-grafana-cloud";

// All tool parameter schemas accept `{ companyId, ... }` and resolve the
// per-company Grafana Cloud config (instance default merged with company
// override) inside the worker before fanning out to the right HTTP client.
const COMPANY_ID = { type: "string", description: "Paperclip company id" } as const;

function toolParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "object",
    properties: { companyId: COMPANY_ID, ...extra },
    required: ["companyId"],
  };
}

interface ToolDecl {
  name: string;
  displayName: string;
  description: string;
  parametersSchema: Record<string, unknown>;
}

const cloudAdminTools: ToolDecl[] = [
  {
    name: "cloud_list_stacks",
    displayName: "List Cloud Stacks",
    description: "List all Grafana Cloud stacks the configured access policy can see.",
    parametersSchema: toolParams(),
  },
  {
    name: "cloud_get_stack",
    displayName: "Get Cloud Stack",
    description: "Fetch full metadata (region, per-service endpoints, instance IDs) for one stack.",
    parametersSchema: toolParams({
      stackSlug: { type: "string", description: "Stack slug to fetch (defaults to configured)" },
    }),
  },
  {
    name: "cloud_list_orgs",
    displayName: "List Cloud Orgs",
    description: "List Grafana Cloud organizations accessible to the access policy.",
    parametersSchema: toolParams(),
  },
  {
    name: "cloud_list_access_policies",
    displayName: "List Access Policies",
    description: "List Cloud Access Policies in the account.",
    parametersSchema: toolParams(),
  },
  {
    name: "cloud_get_access_policy",
    displayName: "Get Access Policy",
    description: "Fetch one Cloud Access Policy by id.",
    parametersSchema: toolParams({ policyId: { type: "string" } }),
  },
  {
    name: "cloud_list_tokens",
    displayName: "List Access Policy Tokens",
    description: "List access policy tokens (metadata only; secret material is never returned).",
    parametersSchema: toolParams({ policyId: { type: "string" } }),
  },
];

const grafanaCoreTools: ToolDecl[] = [
  {
    name: "grafana_search",
    displayName: "Search Grafana",
    description: "Search dashboards, folders, and library panels by query.",
    parametersSchema: toolParams({
      query: { type: "string" },
      type: { type: "string", enum: ["dash-db", "dash-folder"] },
      limit: { type: "number" },
    }),
  },
  {
    name: "grafana_list_dashboards",
    displayName: "List Dashboards",
    description: "List all dashboards visible to the configured service-account token.",
    parametersSchema: toolParams({ folderUid: { type: "string" }, limit: { type: "number" } }),
  },
  {
    name: "grafana_get_dashboard_by_uid",
    displayName: "Get Dashboard",
    description: "Fetch a dashboard's full JSON model by UID.",
    parametersSchema: toolParams({ uid: { type: "string" } }),
  },
  {
    name: "grafana_get_dashboard_versions",
    displayName: "Get Dashboard Versions",
    description: "List version history for a dashboard.",
    parametersSchema: toolParams({ uid: { type: "string" } }),
  },
  {
    name: "grafana_list_folders",
    displayName: "List Folders",
    description: "List dashboard folders.",
    parametersSchema: toolParams(),
  },
  {
    name: "grafana_get_folder",
    displayName: "Get Folder",
    description: "Fetch one folder by UID.",
    parametersSchema: toolParams({ uid: { type: "string" } }),
  },
  {
    name: "grafana_list_datasources",
    displayName: "List Data Sources",
    description: "List configured data sources on the stack.",
    parametersSchema: toolParams(),
  },
  {
    name: "grafana_get_datasource_by_uid",
    displayName: "Get Data Source",
    description: "Fetch one data source by UID.",
    parametersSchema: toolParams({ uid: { type: "string" } }),
  },
  {
    name: "grafana_test_datasource",
    displayName: "Test Data Source",
    description: "Run Grafana's connectivity check against a data source.",
    parametersSchema: toolParams({ uid: { type: "string" } }),
  },
  {
    name: "grafana_list_alert_rules",
    displayName: "List Alert Rules",
    description: "List Grafana-managed alert rules across folders.",
    parametersSchema: toolParams({ folderUid: { type: "string" } }),
  },
  {
    name: "grafana_get_alert_rule",
    displayName: "Get Alert Rule",
    description: "Fetch one alert rule by UID.",
    parametersSchema: toolParams({ uid: { type: "string" } }),
  },
  {
    name: "grafana_get_alert_rule_state",
    displayName: "Get Alert Rule State",
    description: "Fetch current evaluation state (firing/pending/normal) of an alert rule.",
    parametersSchema: toolParams({ uid: { type: "string" } }),
  },
  {
    name: "grafana_list_contact_points",
    displayName: "List Contact Points",
    description: "List notification contact points configured in Grafana Alerting.",
    parametersSchema: toolParams(),
  },
  {
    name: "grafana_list_notification_policies",
    displayName: "List Notification Policies",
    description: "List notification routing policies (the policy tree).",
    parametersSchema: toolParams(),
  },
  {
    name: "grafana_list_mute_timings",
    displayName: "List Mute Timings",
    description: "List Alertmanager mute timings.",
    parametersSchema: toolParams(),
  },
  {
    name: "grafana_list_silences",
    displayName: "List Silences",
    description: "List active and recent silences.",
    parametersSchema: toolParams({ state: { type: "string", enum: ["active", "expired", "pending"] } }),
  },
  {
    name: "grafana_create_silence",
    displayName: "Create Silence",
    description: "Silence matching alerts for a duration.",
    parametersSchema: toolParams({
      matchers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "string" },
            isRegex: { type: "boolean" },
            isEqual: { type: "boolean" },
          },
          required: ["name", "value"],
        },
      },
      startsAt: { type: "string" },
      endsAt: { type: "string" },
      comment: { type: "string" },
      createdBy: { type: "string" },
    }),
  },
  {
    name: "grafana_expire_silence",
    displayName: "Expire Silence",
    description: "End an active silence by id.",
    parametersSchema: toolParams({ silenceId: { type: "string" } }),
  },
  {
    name: "grafana_list_annotations",
    displayName: "List Annotations",
    description: "List dashboard/alert annotations in a time range.",
    parametersSchema: toolParams({
      from: { type: "number", description: "epoch ms" },
      to: { type: "number", description: "epoch ms" },
      dashboardUid: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    }),
  },
  {
    name: "grafana_create_annotation",
    displayName: "Create Annotation",
    description: "Create a graph annotation (e.g. deployment marker).",
    parametersSchema: toolParams({
      time: { type: "number" },
      timeEnd: { type: "number" },
      tags: { type: "array", items: { type: "string" } },
      text: { type: "string" },
      dashboardUid: { type: "string" },
      panelId: { type: "number" },
    }),
  },
  {
    name: "grafana_list_teams",
    displayName: "List Teams",
    description: "List teams configured in the stack.",
    parametersSchema: toolParams(),
  },
  {
    name: "grafana_list_team_members",
    displayName: "List Team Members",
    description: "List members of a team.",
    parametersSchema: toolParams({ teamId: { type: "number" } }),
  },
  {
    name: "grafana_list_users",
    displayName: "List Users",
    description: "List users in the stack.",
    parametersSchema: toolParams(),
  },
  {
    name: "grafana_get_user",
    displayName: "Get User",
    description: "Fetch one user by id.",
    parametersSchema: toolParams({ userId: { type: "number" } }),
  },
  {
    name: "grafana_list_service_accounts",
    displayName: "List Service Accounts",
    description: "List service accounts configured on the stack.",
    parametersSchema: toolParams(),
  },
  {
    name: "grafana_list_library_panels",
    displayName: "List Library Panels",
    description: "List reusable library panels.",
    parametersSchema: toolParams(),
  },
];

const lokiTools: ToolDecl[] = [
  {
    name: "loki_query",
    displayName: "Loki Instant Query",
    description: "Run a LogQL instant query.",
    parametersSchema: toolParams({
      query: { type: "string" },
      time: { type: "string", description: "ISO timestamp" },
      limit: { type: "number" },
    }),
  },
  {
    name: "loki_query_range",
    displayName: "Loki Range Query",
    description: "Run a LogQL range query.",
    parametersSchema: toolParams({
      query: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      step: { type: "string" },
      limit: { type: "number" },
      direction: { type: "string", enum: ["forward", "backward"] },
    }),
  },
  {
    name: "loki_labels",
    displayName: "Loki Labels",
    description: "List label names known to Loki in a time range.",
    parametersSchema: toolParams({ start: { type: "string" }, end: { type: "string" } }),
  },
  {
    name: "loki_label_values",
    displayName: "Loki Label Values",
    description: "List values for one label in a time range.",
    parametersSchema: toolParams({
      label: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
    }),
  },
  {
    name: "loki_series",
    displayName: "Loki Series",
    description: "List series matching a label matcher set.",
    parametersSchema: toolParams({
      match: { type: "array", items: { type: "string" } },
      start: { type: "string" },
      end: { type: "string" },
    }),
  },
  {
    name: "loki_tail_recent",
    displayName: "Loki Tail Recent",
    description: "Fetch the most recent N log lines for a LogQL stream (bounded; no streaming).",
    parametersSchema: toolParams({
      query: { type: "string" },
      limit: { type: "number" },
      lookbackSeconds: { type: "number" },
    }),
  },
  {
    name: "loki_list_rules",
    displayName: "Loki List Rules",
    description: "List recording and alerting rules registered with Loki ruler.",
    parametersSchema: toolParams(),
  },
];

const tempoTools: ToolDecl[] = [
  {
    name: "tempo_search_traces",
    displayName: "Tempo Search Traces",
    description: "Search traces by tags, service, name, and duration.",
    parametersSchema: toolParams({
      tags: { type: "string", description: "logfmt-encoded tag matchers, e.g. 'service.name=web error=true'" },
      minDuration: { type: "string", description: "e.g. 500ms" },
      maxDuration: { type: "string" },
      start: { type: "number", description: "epoch seconds" },
      end: { type: "number", description: "epoch seconds" },
      limit: { type: "number" },
    }),
  },
  {
    name: "tempo_get_trace",
    displayName: "Tempo Get Trace",
    description: "Fetch a full trace by trace id.",
    parametersSchema: toolParams({ traceId: { type: "string" } }),
  },
  {
    name: "tempo_search_tag_names",
    displayName: "Tempo Tag Names",
    description: "List trace tag names known to Tempo.",
    parametersSchema: toolParams(),
  },
  {
    name: "tempo_search_tag_values",
    displayName: "Tempo Tag Values",
    description: "List values for a trace tag.",
    parametersSchema: toolParams({ tag: { type: "string" } }),
  },
  {
    name: "tempo_query_metrics",
    displayName: "Tempo Query Metrics",
    description: "Run a TraceQL-metrics query.",
    parametersSchema: toolParams({
      q: { type: "string" },
      start: { type: "number" },
      end: { type: "number" },
      step: { type: "string" },
    }),
  },
];

const mimirTools: ToolDecl[] = [
  {
    name: "mimir_query",
    displayName: "Mimir Instant Query",
    description: "Run a PromQL instant query against the stack's Mimir / Prometheus endpoint.",
    parametersSchema: toolParams({ query: { type: "string" }, time: { type: "string" } }),
  },
  {
    name: "mimir_query_range",
    displayName: "Mimir Range Query",
    description: "Run a PromQL range query.",
    parametersSchema: toolParams({
      query: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      step: { type: "string" },
    }),
  },
  {
    name: "mimir_labels",
    displayName: "Mimir Labels",
    description: "List label names known to Mimir.",
    parametersSchema: toolParams({ start: { type: "string" }, end: { type: "string" } }),
  },
  {
    name: "mimir_label_values",
    displayName: "Mimir Label Values",
    description: "List values for one label.",
    parametersSchema: toolParams({ label: { type: "string" } }),
  },
  {
    name: "mimir_series",
    displayName: "Mimir Series",
    description: "List series matching label matchers.",
    parametersSchema: toolParams({
      match: { type: "array", items: { type: "string" } },
      start: { type: "string" },
      end: { type: "string" },
    }),
  },
  {
    name: "mimir_list_rules",
    displayName: "Mimir List Rules",
    description: "List recording and alerting rules registered with Mimir ruler.",
    parametersSchema: toolParams(),
  },
  {
    name: "mimir_get_rule_group",
    displayName: "Mimir Get Rule Group",
    description: "Fetch one rule group by namespace + name.",
    parametersSchema: toolParams({ namespace: { type: "string" }, name: { type: "string" } }),
  },
  {
    name: "mimir_list_alertmanager_alerts",
    displayName: "Mimir Alertmanager Alerts",
    description: "List currently firing alerts on Mimir's Alertmanager.",
    parametersSchema: toolParams({ active: { type: "boolean" }, silenced: { type: "boolean" } }),
  },
  {
    name: "mimir_metadata",
    displayName: "Mimir Metric Metadata",
    description: "List metric metadata (help text, type).",
    parametersSchema: toolParams({ metric: { type: "string" }, limit: { type: "number" } }),
  },
  {
    name: "mimir_targets",
    displayName: "Mimir Targets",
    description: "List exporter targets known to Mimir (when exposed).",
    parametersSchema: toolParams({ state: { type: "string", enum: ["active", "dropped", "any"] } }),
  },
  // Convenience aliases — LLMs often prefer the `prom_` name. Routed to the
  // same handlers as the `mimir_` counterparts.
  {
    name: "prom_query",
    displayName: "Prometheus Instant Query",
    description: "Alias of mimir_query.",
    parametersSchema: toolParams({ query: { type: "string" }, time: { type: "string" } }),
  },
  {
    name: "prom_query_range",
    displayName: "Prometheus Range Query",
    description: "Alias of mimir_query_range.",
    parametersSchema: toolParams({
      query: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      step: { type: "string" },
    }),
  },
  {
    name: "prom_labels",
    displayName: "Prometheus Labels",
    description: "Alias of mimir_labels.",
    parametersSchema: toolParams({ start: { type: "string" }, end: { type: "string" } }),
  },
  {
    name: "prom_label_values",
    displayName: "Prometheus Label Values",
    description: "Alias of mimir_label_values.",
    parametersSchema: toolParams({ label: { type: "string" } }),
  },
];

const pyroscopeTools: ToolDecl[] = [
  {
    name: "pyroscope_list_apps",
    displayName: "Pyroscope List Apps",
    description: "List applications profiled in Pyroscope.",
    parametersSchema: toolParams(),
  },
  {
    name: "pyroscope_query_profile",
    displayName: "Pyroscope Query Profile",
    description: "Fetch an aggregated profile for a query in a time range.",
    parametersSchema: toolParams({
      query: { type: "string" },
      from: { type: "string" },
      until: { type: "string" },
      format: { type: "string", enum: ["json", "pprof", "collapsed"] },
    }),
  },
  {
    name: "pyroscope_label_names",
    displayName: "Pyroscope Label Names",
    description: "List Pyroscope label names.",
    parametersSchema: toolParams({ start: { type: "string" }, end: { type: "string" } }),
  },
  {
    name: "pyroscope_label_values",
    displayName: "Pyroscope Label Values",
    description: "List values for a Pyroscope label.",
    parametersSchema: toolParams({ label: { type: "string" } }),
  },
  {
    name: "pyroscope_get_flamegraph",
    displayName: "Pyroscope Flamegraph",
    description: "Render a flamegraph for a Pyroscope query (collapsed format).",
    parametersSchema: toolParams({
      query: { type: "string" },
      from: { type: "string" },
      until: { type: "string" },
    }),
  },
];

const faroTools: ToolDecl[] = [
  {
    name: "faro_list_apps",
    displayName: "Faro List Apps",
    description: "List Faro RUM applications.",
    parametersSchema: toolParams(),
  },
  {
    name: "faro_get_app",
    displayName: "Faro Get App",
    description: "Fetch one Faro app by id.",
    parametersSchema: toolParams({ appId: { type: "string" } }),
  },
  {
    name: "faro_query_measurements",
    displayName: "Faro Measurements",
    description: "Query frontend performance measurements via the bundled Prom endpoint.",
    parametersSchema: toolParams({
      appId: { type: "string" },
      query: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
    }),
  },
  {
    name: "faro_list_recent_errors",
    displayName: "Faro Recent Errors",
    description: "Fetch recent JS errors and exceptions from the Faro Loki tenant.",
    parametersSchema: toolParams({
      appId: { type: "string" },
      lookbackSeconds: { type: "number" },
      limit: { type: "number" },
    }),
  },
];

const syntheticTools: ToolDecl[] = [
  {
    name: "sm_list_probes",
    displayName: "Synthetic List Probes",
    description: "List Synthetic Monitoring probes.",
    parametersSchema: toolParams(),
  },
  {
    name: "sm_get_probe",
    displayName: "Synthetic Get Probe",
    description: "Fetch one probe by id.",
    parametersSchema: toolParams({ probeId: { type: "number" } }),
  },
  {
    name: "sm_list_checks",
    displayName: "Synthetic List Checks",
    description: "List configured synthetic checks.",
    parametersSchema: toolParams(),
  },
  {
    name: "sm_get_check",
    displayName: "Synthetic Get Check",
    description: "Fetch one check by id.",
    parametersSchema: toolParams({ checkId: { type: "number" } }),
  },
  {
    name: "sm_create_check",
    displayName: "Synthetic Create Check",
    description: "Create a new synthetic check.",
    parametersSchema: toolParams({ check: { type: "object" } }),
  },
  {
    name: "sm_update_check",
    displayName: "Synthetic Update Check",
    description: "Update an existing synthetic check.",
    parametersSchema: toolParams({ checkId: { type: "number" }, check: { type: "object" } }),
  },
  {
    name: "sm_delete_check",
    displayName: "Synthetic Delete Check",
    description: "Delete a synthetic check.",
    parametersSchema: toolParams({ checkId: { type: "number" } }),
  },
  {
    name: "sm_list_check_results",
    displayName: "Synthetic Check Results",
    description: "Fetch recent results for a check (via bundled Loki/metrics).",
    parametersSchema: toolParams({
      checkId: { type: "number" },
      lookbackSeconds: { type: "number" },
    }),
  },
  {
    name: "sm_list_tenants",
    displayName: "Synthetic List Tenants",
    description: "List synthetic monitoring tenants.",
    parametersSchema: toolParams(),
  },
];

const oncallTools: ToolDecl[] = [
  {
    name: "oncall_list_schedules",
    displayName: "OnCall List Schedules",
    description: "List OnCall schedules.",
    parametersSchema: toolParams(),
  },
  {
    name: "oncall_get_schedule",
    displayName: "OnCall Get Schedule",
    description: "Fetch one schedule by id.",
    parametersSchema: toolParams({ scheduleId: { type: "string" } }),
  },
  {
    name: "oncall_get_on_call_now",
    displayName: "Who's On Call Now",
    description: "Return the users currently on call for a schedule (or all schedules).",
    parametersSchema: toolParams({ scheduleId: { type: "string" } }),
  },
  {
    name: "oncall_list_escalation_chains",
    displayName: "OnCall Escalation Chains",
    description: "List escalation chains.",
    parametersSchema: toolParams(),
  },
  {
    name: "oncall_get_escalation_chain",
    displayName: "OnCall Get Escalation Chain",
    description: "Fetch one escalation chain by id.",
    parametersSchema: toolParams({ chainId: { type: "string" } }),
  },
  {
    name: "oncall_list_alert_groups",
    displayName: "OnCall Alert Groups",
    description: "List alert groups (incidents in OnCall terminology).",
    parametersSchema: toolParams({
      state: { type: "string", enum: ["new", "acknowledged", "resolved", "silenced"] },
      lookbackSeconds: { type: "number" },
    }),
  },
  {
    name: "oncall_get_alert_group",
    displayName: "OnCall Get Alert Group",
    description: "Fetch one alert group by id.",
    parametersSchema: toolParams({ alertGroupId: { type: "string" } }),
  },
  {
    name: "oncall_ack_alert_group",
    displayName: "OnCall Acknowledge",
    description: "Acknowledge an alert group on behalf of the current responder.",
    parametersSchema: toolParams({ alertGroupId: { type: "string" } }),
  },
  {
    name: "oncall_resolve_alert_group",
    displayName: "OnCall Resolve",
    description: "Resolve an alert group.",
    parametersSchema: toolParams({ alertGroupId: { type: "string" } }),
  },
  {
    name: "oncall_list_users",
    displayName: "OnCall Users",
    description: "List OnCall users.",
    parametersSchema: toolParams(),
  },
  {
    name: "oncall_list_teams",
    displayName: "OnCall Teams",
    description: "List OnCall teams.",
    parametersSchema: toolParams(),
  },
];

const irmTools: ToolDecl[] = [
  {
    name: "irm_list_incidents",
    displayName: "IRM List Incidents",
    description: "List open and recent incidents.",
    parametersSchema: toolParams({
      status: { type: "string", enum: ["active", "resolved", "all"] },
      severity: { type: "string" },
      limit: { type: "number" },
    }),
  },
  {
    name: "irm_get_incident",
    displayName: "IRM Get Incident",
    description: "Fetch one incident by id.",
    parametersSchema: toolParams({ incidentId: { type: "string" } }),
  },
  {
    name: "irm_list_incident_activities",
    displayName: "IRM Incident Timeline",
    description: "Fetch the timeline of activities for an incident.",
    parametersSchema: toolParams({ incidentId: { type: "string" } }),
  },
  {
    name: "irm_list_runbooks",
    displayName: "IRM Runbooks",
    description: "List runbooks defined in IRM.",
    parametersSchema: toolParams(),
  },
  {
    name: "irm_create_incident",
    displayName: "IRM Create Incident",
    description: "Open a new incident.",
    parametersSchema: toolParams({
      title: { type: "string" },
      severity: { type: "string" },
      summary: { type: "string" },
    }),
  },
  {
    name: "irm_add_incident_note",
    displayName: "IRM Add Note",
    description: "Append a note to an existing incident's timeline.",
    parametersSchema: toolParams({ incidentId: { type: "string" }, body: { type: "string" } }),
  },
];

const k6Tools: ToolDecl[] = [
  {
    name: "k6_list_projects",
    displayName: "k6 List Projects",
    description: "List k6 Cloud projects.",
    parametersSchema: toolParams(),
  },
  {
    name: "k6_list_test_runs",
    displayName: "k6 List Test Runs",
    description: "List test runs (optionally filtered by project).",
    parametersSchema: toolParams({ projectId: { type: "number" }, limit: { type: "number" } }),
  },
  {
    name: "k6_get_test_run",
    displayName: "k6 Get Test Run",
    description: "Fetch one test run by id.",
    parametersSchema: toolParams({ testRunId: { type: "number" } }),
  },
  {
    name: "k6_list_test_run_metrics",
    displayName: "k6 Test Run Metrics",
    description: "List metrics for a test run.",
    parametersSchema: toolParams({ testRunId: { type: "number" } }),
  },
  {
    name: "k6_list_scripts",
    displayName: "k6 List Scripts",
    description: "List k6 scripts.",
    parametersSchema: toolParams({ projectId: { type: "number" } }),
  },
  {
    name: "k6_get_script",
    displayName: "k6 Get Script",
    description: "Fetch one k6 script.",
    parametersSchema: toolParams({ scriptId: { type: "number" } }),
  },
];

const allTools: ToolDecl[] = [
  ...cloudAdminTools,
  ...grafanaCoreTools,
  ...lokiTools,
  ...tempoTools,
  ...mimirTools,
  ...pyroscopeTools,
  ...faroTools,
  ...syntheticTools,
  ...oncallTools,
  ...irmTools,
  ...k6Tools,
];

export const TOOL_NAMES = allTools.map((t) => t.name);

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Grafana Cloud",
  description:
    "Expose the whole Grafana Cloud stack to Paperclip agents: Grafana core, Loki, Tempo, Mimir/Prometheus, Pyroscope, Faro, Synthetic Monitoring, OnCall, IRM, k6, and Cloud Admin.",
  author: "Paperclip",
  categories: ["connector", "ui"],
  capabilities: [
    "http.outbound",
    "secrets.read-ref",
    "agent.tools.register",
    "api.routes.register",
    "plugin.state.read",
    "plugin.state.write",
    "companies.read",
    "events.subscribe",
    "instance.settings.register",
    "ui.sidebar.register",
    "ui.page.register",
    "ui.dashboardWidget.register",
    "activity.log.write",
    "metrics.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      defaults: {
        type: "object",
        properties: {
          stackSlug: { type: "string", description: "Grafana Cloud stack slug" },
          region: { type: "string", description: "Stack region slug, e.g. prod-us-east-0" },
          cloudAccessTokenRef: {
            type: "string",
            format: "secret-ref",
            description: "grafana.com Cloud Access Policy token (stack lookup, Cloud Admin)",
          },
          stackTokenRef: {
            type: "string",
            format: "secret-ref",
            description: "Stack service-account token (Grafana core, Loki, Tempo, Mimir, OnCall, IRM, etc.)",
          },
          timeoutMs: { type: "number", description: "Per-request HTTP timeout (default 30000)" },
          httpRetryCount: { type: "number", description: "Retries on 5xx (default 2)" },
        },
        required: ["stackSlug", "region", "cloudAccessTokenRef", "stackTokenRef"],
      },
    },
    required: ["defaults"],
  },
  apiRoutes: [
    {
      routeKey: "overview",
      method: "GET",
      path: "/overview",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "stacks",
      method: "GET",
      path: "/stacks",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "alerts",
      method: "GET",
      path: "/alerts",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "incidents",
      method: "GET",
      path: "/incidents",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "save-company-override",
      method: "POST",
      path: "/company-override",
      auth: "board",
      capability: "api.routes.register",
      companyResolution: { from: "body", key: "companyId" },
    },
  ],
  tools: allTools,
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "grafana-cloud-sidebar",
        displayName: "Grafana Cloud",
        exportName: "SidebarLink",
        order: 60,
      },
      {
        type: "page",
        id: "grafana-cloud-page",
        displayName: "Grafana Cloud",
        exportName: "OverviewPage",
        routePath: "grafana-cloud",
      },
      {
        type: "dashboardWidget",
        id: "grafana-cloud-incidents-widget",
        displayName: "Open Incidents",
        exportName: "IncidentsWidget",
      },
      {
        type: "dashboardWidget",
        id: "grafana-cloud-alerts-widget",
        displayName: "Firing Alerts",
        exportName: "AlertsWidget",
      },
      {
        type: "companySettingsPage",
        id: "grafana-cloud-company-settings",
        displayName: "Grafana Cloud",
        exportName: "CompanySettingsPage",
        routePath: "grafana-cloud",
      },
    ],
  },
};

export default manifest;

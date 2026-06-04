# @paperclipai/plugin-grafana-cloud

Expose the whole Grafana Cloud stack to Paperclip agents as tools, plus light UI for incident and alert visibility.

## What it covers

| Surface | Prefix | Examples |
|---|---|---|
| Grafana Cloud Admin (grafana.com) | `cloud_*` | `cloud_list_stacks`, `cloud_list_access_policies` |
| Grafana core (dashboards, alerts, datasources) | `grafana_*` | `grafana_list_alert_rules`, `grafana_create_silence` |
| Loki (logs) | `loki_*` | `loki_query_range`, `loki_label_values` |
| Tempo (traces) | `tempo_*` | `tempo_search_traces`, `tempo_get_trace` |
| Mimir / Prometheus (metrics) | `mimir_*` / `prom_*` | `mimir_query_range`, `mimir_list_alertmanager_alerts` |
| Pyroscope (profiles) | `pyroscope_*` | `pyroscope_query_profile` |
| Faro (frontend RUM) | `faro_*` | `faro_list_recent_errors` |
| Synthetic Monitoring | `sm_*` | `sm_list_checks`, `sm_list_check_results` |
| OnCall | `oncall_*` | `oncall_get_on_call_now` |
| IRM / Incident | `irm_*` | `irm_list_incidents`, `irm_create_incident` |
| k6 Cloud | `k6_*` | `k6_list_test_runs` |

About 70 tools in total. All take `{ companyId, ... }` and route through the per-company config (instance default merged with company override).

## Configuration

Set instance-wide defaults via `/settings/plugins/paperclipai.plugin-grafana-cloud`, or via Nix (see `services.paperclip.grafanaCloud.*` in `nix/modules/nixos/paperclip.nix`). Board users can override per company at `/:companyPrefix/company/settings/grafana-cloud`.

Required fields:

| Field | Source | Purpose |
|---|---|---|
| `stackSlug` | env `GRAFANA_CLOUD_STACK_SLUG` | Stack to look up at `grafana.com/api/instances/<slug>` |
| `region` | env `GRAFANA_CLOUD_REGION` | Region slug, e.g. `prod-us-east-0` |
| `cloudAccessTokenRef` | env `GRAFANA_CLOUD_CLOUD_TOKEN_FILE` (path) | Cloud Access Policy token; used for grafana.com + Cloud Admin tools |
| `stackTokenRef` | env `GRAFANA_CLOUD_STACK_TOKEN_FILE` (path) | Stack service-account token; used for everything stack-scoped |

Token values themselves never leave secret storage — only secret-refs are persisted in plugin config.

## End-to-end test

From a board agent chat:

- `list Grafana Cloud stacks` → `cloud_list_stacks`
- `what's firing on acmeprod` → `grafana_list_alert_rules` + `mimir_list_alertmanager_alerts`
- `rate(http_requests_total[5m]) over the last hour` → `mimir_query_range`
- `who's on call now` → `oncall_get_on_call_now`
- `show open incidents` → `irm_list_incidents`

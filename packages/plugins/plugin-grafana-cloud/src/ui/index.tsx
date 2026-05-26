import {
  MetricCard,
  Spinner,
  StatusBadge,
  usePluginAction,
  usePluginData,
  useHostContext,
  type PluginPageProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import React, { useState } from "react";

interface OverviewData {
  stacks?: unknown;
  incidents?: { incidents?: Array<{ incidentID: string; title: string; status: string; severity: string }> } | null;
  alerts?: Array<{ labels?: Record<string, string>; status?: { state?: string } }> | null;
  errors?: string[];
  error?: string;
}

export function SidebarLink() {
  return <span>Grafana Cloud</span>;
}

export function OverviewPage(_props: PluginPageProps) {
  const ctx = useHostContext();
  const { data, loading, error } = usePluginData<OverviewData>("overview", {
    companyId: ctx.companyId,
  });

  if (loading) return <Spinner />;
  if (error) return <div style={{ padding: 16 }}>Failed to load: {error.message}</div>;
  if (!data) return <div style={{ padding: 16 }}>No data</div>;

  const activeIncidents = data.incidents?.incidents?.filter((i) => i.status === "active") ?? [];
  const firingAlerts = data.alerts ?? [];

  return (
    <div style={{ padding: 16 }}>
      <h2>Grafana Cloud</h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <MetricCard label="Open Incidents" value={activeIncidents.length} />
        <MetricCard label="Firing Alerts" value={firingAlerts.length} />
      </div>
      {data.errors && data.errors.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <StatusBadge status="warning" label={`${data.errors.length} sub-call(s) failed`} />
        </div>
      )}
      <h3 style={{ marginTop: 24 }}>Open incidents</h3>
      {activeIncidents.length === 0 ? (
        <div>None</div>
      ) : (
        <ul>
          {activeIncidents.map((i) => (
            <li key={i.incidentID}>
              <strong>{i.title}</strong> — {i.severity}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IncidentsWidget(_props: PluginWidgetProps) {
  const ctx = useHostContext();
  const { data, loading } = usePluginData<OverviewData>("overview", { companyId: ctx.companyId });
  if (loading) return <Spinner />;
  const count = data?.incidents?.incidents?.filter((i) => i.status === "active").length ?? 0;
  return <MetricCard label="Grafana Cloud · Open Incidents" value={count} />;
}

export function AlertsWidget(_props: PluginWidgetProps) {
  const ctx = useHostContext();
  const { data, loading } = usePluginData<OverviewData>("overview", { companyId: ctx.companyId });
  if (loading) return <Spinner />;
  const count = data?.alerts?.length ?? 0;
  return <MetricCard label="Grafana Cloud · Firing Alerts" value={count} />;
}

export function CompanySettingsPage(props: Readonly<{ companyId: string }>) {
  const ctx = useHostContext();
  const companyId = props.companyId ?? ctx.companyId ?? "";
  const save = usePluginAction("save-company-override");
  const [stackSlug, setStackSlug] = useState("");
  const [region, setRegion] = useState("");
  const [cloudRef, setCloudRef] = useState("");
  const [stackRef, setStackRef] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("saving…");
    try {
      await save({
        companyId,
        stackSlug: stackSlug || undefined,
        region: region || undefined,
        cloudAccessTokenRef: cloudRef || undefined,
        stackTokenRef: stackRef || undefined,
      });
      setStatus("saved");
    } catch (err) {
      setStatus(`failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <form onSubmit={onSubmit} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}>
      <h2>Grafana Cloud · company override</h2>
      <label>
        <span>Stack slug</span>
        <input value={stackSlug} onChange={(e) => setStackSlug(e.target.value)} placeholder="leave blank to inherit" />
      </label>
      <label>
        <span>Region</span>
        <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="leave blank to inherit" />
      </label>
      <label>
        <span>Cloud Access Policy token (secret ref)</span>
        <input value={cloudRef} onChange={(e) => setCloudRef(e.target.value)} placeholder="leave blank to inherit" />
      </label>
      <label>
        <span>Stack service-account token (secret ref)</span>
        <input value={stackRef} onChange={(e) => setStackRef(e.target.value)} placeholder="leave blank to inherit" />
      </label>
      <button type="submit">Save override</button>
      {status && <div>{status}</div>}
    </form>
  );
}

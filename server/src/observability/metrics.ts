import { metrics, type Counter, type Histogram, type Meter } from "@opentelemetry/api";

/**
 * Paperclip domain metrics. Single source of truth for the counters and
 * histograms that the server emits about its own behaviour. Tied to the
 * default Meter from the global MeterProvider — when telemetry is disabled,
 * the provider is a no-op and these record into the void at near-zero cost.
 *
 * Call sites import the named counters/histograms and increment them at the
 * event boundary. Keep instrument names stable: dashboards and alerts in
 * Grafana Cloud are wired to them.
 */
class PaperclipMetrics {
  private readonly meter: Meter;

  readonly agentRunsStarted: Counter;
  readonly agentRunsFinished: Counter;
  readonly agentRunsFailed: Counter;
  readonly agentRunsCancelled: Counter;
  readonly agentRunDurationMs: Histogram;

  readonly pluginWorkerStarts: Counter;
  readonly pluginWorkerRestarts: Counter;
  readonly pluginWorkerCrashes: Counter;
  readonly pluginRpcDurationMs: Histogram;
  readonly pluginToolCallsTotal: Counter;

  readonly jobRunsStarted: Counter;
  readonly jobRunsSucceeded: Counter;
  readonly jobRunsFailed: Counter;

  readonly webhookDeliveriesReceived: Counter;
  readonly webhookDeliveriesProcessed: Counter;
  readonly webhookDeliveriesFailed: Counter;

  readonly secretAccessesTotal: Counter;
  readonly approvalsDecidedTotal: Counter;
  readonly budgetIncidentsOpened: Counter;

  readonly httpServerRequestsTotal: Counter;
  readonly httpServerRequestDurationMs: Histogram;

  constructor() {
    this.meter = metrics.getMeter("paperclip", "0.1.0");

    this.agentRunsStarted = this.meter.createCounter("paperclip.agent_runs.started", {
      description: "Total agent runs started",
    });
    this.agentRunsFinished = this.meter.createCounter("paperclip.agent_runs.finished", {
      description: "Total agent runs that finished successfully",
    });
    this.agentRunsFailed = this.meter.createCounter("paperclip.agent_runs.failed", {
      description: "Total agent runs that failed",
    });
    this.agentRunsCancelled = this.meter.createCounter("paperclip.agent_runs.cancelled", {
      description: "Total agent runs that were cancelled",
    });
    this.agentRunDurationMs = this.meter.createHistogram("paperclip.agent_runs.duration_ms", {
      description: "Agent run wall-clock duration",
      unit: "ms",
    });

    this.pluginWorkerStarts = this.meter.createCounter("paperclip.plugin_worker.starts", {
      description: "Plugin worker process starts",
    });
    this.pluginWorkerRestarts = this.meter.createCounter("paperclip.plugin_worker.restarts", {
      description: "Plugin worker process restarts after crash",
    });
    this.pluginWorkerCrashes = this.meter.createCounter("paperclip.plugin_worker.crashes", {
      description: "Plugin worker process crashes",
    });
    this.pluginRpcDurationMs = this.meter.createHistogram("paperclip.plugin_rpc.duration_ms", {
      description: "Host→worker RPC duration",
      unit: "ms",
    });
    this.pluginToolCallsTotal = this.meter.createCounter("paperclip.plugin_tool_calls.total", {
      description: "Total plugin tool calls dispatched to a worker",
    });

    this.jobRunsStarted = this.meter.createCounter("paperclip.job_runs.started", {
      description: "Scheduled plugin job runs started",
    });
    this.jobRunsSucceeded = this.meter.createCounter("paperclip.job_runs.succeeded", {
      description: "Scheduled plugin job runs that succeeded",
    });
    this.jobRunsFailed = this.meter.createCounter("paperclip.job_runs.failed", {
      description: "Scheduled plugin job runs that failed",
    });

    this.webhookDeliveriesReceived = this.meter.createCounter("paperclip.webhook_deliveries.received", {
      description: "Inbound plugin webhook deliveries received",
    });
    this.webhookDeliveriesProcessed = this.meter.createCounter("paperclip.webhook_deliveries.processed", {
      description: "Webhook deliveries successfully handled",
    });
    this.webhookDeliveriesFailed = this.meter.createCounter("paperclip.webhook_deliveries.failed", {
      description: "Webhook deliveries that failed handling",
    });

    this.secretAccessesTotal = this.meter.createCounter("paperclip.secrets.accesses_total", {
      description: "Total secret-ref resolutions",
    });
    this.approvalsDecidedTotal = this.meter.createCounter("paperclip.approvals.decided_total", {
      description: "Approvals decided (approved/rejected) — labelled by decision",
    });
    this.budgetIncidentsOpened = this.meter.createCounter("paperclip.budget.incidents_opened", {
      description: "Budget hard-stop incidents opened",
    });

    this.httpServerRequestsTotal = this.meter.createCounter("paperclip.http.server.requests_total", {
      description: "HTTP server requests by route and status",
    });
    this.httpServerRequestDurationMs = this.meter.createHistogram(
      "paperclip.http.server.duration_ms",
      {
        description: "HTTP server request duration",
        unit: "ms",
      },
    );
  }
}

let instance: PaperclipMetrics | null = null;

/**
 * Lazily-initialised global metrics handle. Safe to call before
 * `initObservability()` — metrics created here will bind to whatever
 * MeterProvider is registered at first call (no-op or real exporter).
 */
export function paperclipMetrics(): PaperclipMetrics {
  instance ??= new PaperclipMetrics();
  return instance;
}

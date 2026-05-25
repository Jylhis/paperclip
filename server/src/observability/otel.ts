import { diag, DiagConsoleLogger, DiagLogLevel, metrics, trace } from "@opentelemetry/api";
import { logs as logsApi } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HostMetrics } from "@opentelemetry/host-metrics";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type { GrafanaCloudObservabilityConfig } from "./config.js";
import type { GrafanaCloudStackInfo } from "./stack-info.js";

const PAPERCLIP_SERVICE_NAMESPACE = "paperclip";

export interface InitializedObservability {
  sdk: NodeSDK;
  loggerProvider: LoggerProvider;
  hostMetrics: HostMetrics;
  shutdown: (deadlineMs?: number) => Promise<void>;
}

/**
 * Builds OTLP exporters pointed at the Grafana Cloud OTLP gateway, configures
 * a Node SDK with auto-instrumentation, and starts the host-metrics collector.
 * Returns a shutdown helper that flushes all signals within a deadline — used
 * by both the crash handler and the normal SIGTERM path.
 */
export function startOpenTelemetry(input: {
  config: GrafanaCloudObservabilityConfig;
  stack: GrafanaCloudStackInfo;
  serverVersion: string;
}): InitializedObservability {
  if (process.env.OTEL_LOG_LEVEL) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const authHeader =
    "Basic " +
    Buffer.from(`${input.stack.otlpInstanceId}:${input.config.stackToken}`).toString("base64");
  const otlpHeaders = { Authorization: authHeader };

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: input.config.serviceName,
    [ATTR_SERVICE_NAMESPACE]: PAPERCLIP_SERVICE_NAMESPACE,
    [ATTR_SERVICE_VERSION]: input.serverVersion,
    "deployment.environment": input.config.deploymentEnv,
    "grafana_cloud.stack_slug": input.config.stackSlug,
    "grafana_cloud.region": input.config.region,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${input.stack.otlpEndpoint}/v1/traces`,
    headers: otlpHeaders,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${input.stack.otlpEndpoint}/v1/metrics`,
    headers: otlpHeaders,
  });

  const logExporter = new OTLPLogExporter({
    url: `${input.stack.otlpEndpoint}/v1/logs`,
    headers: otlpHeaders,
  });

  const sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(input.config.samplingRatio),
  });

  const sdk = new NodeSDK({
    resource,
    sampler,
    traceExporter,
    // Cross-version MetricReader interfaces between @opentelemetry/sdk-node's
    // pinned sdk-metrics and the one resolved here would otherwise produce a
    // structural-typing mismatch on a private `_shutdown` field. The shape is
    // identical at runtime.
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 30_000,
    }) as never,
    instrumentations: [
      getNodeAutoInstrumentations({
        // pino instrumentation injects trace context into log records; logs
        // themselves are shipped via the BatchLogRecordProcessor below.
        "@opentelemetry/instrumentation-pino": { enabled: true },
        // fs auto-instrumentation produces too many low-value spans.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();

  // sdk-node does not yet wire LoggerProvider through `NodeSDK`, so register
  // it explicitly so api-logs and the pino transport can emit log records.
  const loggerProvider = new LoggerProvider({ resource });
  loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));
  logsApi.setGlobalLoggerProvider(loggerProvider);

  const hostMetrics = new HostMetrics({
    meterProvider: metrics.getMeterProvider() as never,
    name: input.config.serviceName,
  });
  hostMetrics.start();

  const shutdown = async (deadlineMs = 3000): Promise<void> => {
    const tasks: Array<Promise<unknown>> = [
      sdk.shutdown().catch(() => undefined),
      loggerProvider.shutdown().catch(() => undefined),
    ];
    await Promise.race([
      Promise.all(tasks),
      new Promise<void>((resolve) => {
        setTimeout(resolve, deadlineMs).unref?.();
      }),
    ]);
  };

  return { sdk, loggerProvider, hostMetrics, shutdown };
}

/**
 * Build a `paperclip.crash` span around a fatal error, then force-flush all
 * signals within the deadline. Returns a promise that resolves once the
 * flush completes (or times out). The caller is responsible for `process.exit`.
 */
export async function emitCrashSpanAndFlush(input: {
  error: unknown;
  shutdown: (deadlineMs?: number) => Promise<void>;
  source: "uncaughtException" | "unhandledRejection";
  deadlineMs?: number;
}): Promise<void> {
  const tracer = trace.getTracer("paperclip.crash");
  const span = tracer.startSpan("paperclip.crash", {
    attributes: {
      "crash.source": input.source,
      "exception.type":
        input.error instanceof Error ? input.error.name : typeof input.error,
      "exception.message":
        input.error instanceof Error ? input.error.message : String(input.error),
    },
  });
  if (input.error instanceof Error) {
    span.recordException(input.error);
  } else {
    span.recordException(new Error(String(input.error)));
  }
  span.setStatus({ code: 2, message: "process is crashing" });
  span.end();

  await input.shutdown(input.deadlineMs ?? 3000);
}

import type { Logger } from "pino";
import { loadObservabilityConfig } from "./config.js";
import { installCrashHandler } from "./crash-handler.js";
import { emitCrashSpanAndFlush, startOpenTelemetry, type InitializedObservability } from "./otel.js";
import { fetchGrafanaCloudStackInfo } from "./stack-info.js";

export { paperclipMetrics } from "./metrics.js";
export { installCrashHandler } from "./crash-handler.js";
export { loadObservabilityConfig } from "./config.js";

export interface InitObservabilityResult {
  enabled: boolean;
  shutdown: (deadlineMs?: number) => Promise<void>;
}

/**
 * Bootstrap Paperclip observability. Always installs the crash handler so
 * unhandled exceptions land in stderr with stack traces. When Grafana Cloud
 * config is present, additionally starts OpenTelemetry with OTLP exporters
 * pointed at the configured stack and registers a crash hook that flushes a
 * `paperclip.crash` span before exit.
 *
 * Returns a `shutdown` helper to be called from the normal SIGTERM path so
 * in-flight metric and trace exports drain before the process exits.
 */
export async function initObservability(input: {
  logger: Logger;
  serverVersion: string;
}): Promise<InitObservabilityResult> {
  const cfg = loadObservabilityConfig();

  if (!cfg.selfTelemetry) {
    // Telemetry disabled — still install the crash handler so a fatal error
    // produces a clear stderr log instead of a silent exit.
    installCrashHandler({ logger: input.logger });
    return {
      enabled: false,
      shutdown: async () => undefined,
    };
  }

  let observability: InitializedObservability | null = null;
  try {
    const stack = await fetchGrafanaCloudStackInfo({
      stackSlug: cfg.selfTelemetry.stackSlug,
      cloudAccessToken: cfg.selfTelemetry.cloudAccessToken,
    });
    observability = startOpenTelemetry({
      config: cfg.selfTelemetry,
      stack,
      serverVersion: input.serverVersion,
    });
    input.logger.info(
      {
        stackSlug: stack.slug,
        region: stack.region,
        otlpEndpoint: stack.otlpEndpoint,
      },
      "Grafana Cloud observability enabled",
    );
  } catch (err) {
    input.logger.error(
      { err },
      "failed to start Grafana Cloud observability; continuing without OTLP exporters",
    );
  }

  installCrashHandler({
    logger: input.logger,
    onCrash: async ({ error, source }) => {
      if (!observability) return;
      await emitCrashSpanAndFlush({
        error,
        source,
        shutdown: observability.shutdown,
      });
    },
  });

  return {
    enabled: observability !== null,
    shutdown: async (deadlineMs?: number) => {
      if (observability) {
        await observability.shutdown(deadlineMs);
      }
    },
  };
}

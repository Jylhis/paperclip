/**
 * Synchronously register OpenTelemetry auto-instrumentation patches BEFORE
 * any modules that should be instrumented (node:http, express, pg, drizzle,
 * etc.) are first loaded.
 *
 * This module MUST be imported as the very first import in the process
 * entrypoint. `registerInstrumentations` from `@opentelemetry/instrumentation`
 * installs `require-in-the-middle` / `import-in-the-middle` hooks at the time
 * it runs; instrumentations applied after the target modules are cached are
 * silently no-ops.
 *
 * The actual TracerProvider, MeterProvider, and OTLP exporters are wired up
 * later in `startOpenTelemetry()` once the async grafana.com stack lookup
 * has resolved. The pre-registered instrumentations bind to the global
 * tracer/meter providers and start emitting once that wiring completes.
 */
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const enabledRaw = process.env.GRAFANA_CLOUD_SELF_TELEMETRY_ENABLED?.trim().toLowerCase();
const enabled = enabledRaw === "true" || enabledRaw === "1";

if (enabled) {
  registerInstrumentations({
    instrumentations: [
      getNodeAutoInstrumentations({
        // pino instrumentation injects trace context into log records.
        "@opentelemetry/instrumentation-pino": { enabled: true },
        // fs auto-instrumentation produces too many low-value spans.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });
}

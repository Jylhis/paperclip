import { logs as logsApi, SeverityNumber } from "@opentelemetry/api-logs";

const SEVERITY_BY_LEVEL: ReadonlyArray<[number, SeverityNumber, string]> = [
  [60, SeverityNumber.FATAL, "FATAL"],
  [50, SeverityNumber.ERROR, "ERROR"],
  [40, SeverityNumber.WARN, "WARN"],
  [30, SeverityNumber.INFO, "INFO"],
  [20, SeverityNumber.DEBUG, "DEBUG"],
  [10, SeverityNumber.TRACE, "TRACE"],
];

interface OtelMirrorState {
  loggerName: string;
}

/**
 * Returns a pino `hooks.logMethod` that mirrors every log call into the OTel
 * logs API in the main thread (where the OTel SDK is initialised). Pino's own
 * transports (stdout-pretty, file) keep running as before; this only adds a
 * second sink. When the OTel SDK isn't running, the global logger provider is
 * a no-op and `emit()` quietly drops records — zero-cost off-path.
 *
 * The hook is installed only when `GRAFANA_CLOUD_SELF_TELEMETRY_ENABLED=true`,
 * so we never pay for the OTel API roundtrip in deployments that don't use it.
 */
export function createOtelLogMirror(state: OtelMirrorState) {
  const otelLogger = logsApi.getLogger(state.loggerName);

  return function logMethod(
    this: { level: string | number },
    args: unknown[],
    method: (...args: unknown[]) => void,
    level: number,
  ): void {
    // Pino's logMethod is invoked with the raw arguments; the first may be a
    // bindings object, the rest form the message. We never modify them — we
    // only peek at them to forward to OTel.
    const { body, attributes } = extractFromArgs(args);
    const [severityNumber, severityText] = severityFromLevel(level);

    otelLogger.emit({
      timestamp: new Date(),
      severityNumber,
      severityText,
      body,
      attributes: attributes as Record<string, string | number | boolean>,
    });

    method.apply(this, args as unknown as []);
  };
}

function extractFromArgs(args: unknown[]): {
  body: string;
  attributes: Record<string, unknown>;
} {
  if (args.length === 0) return { body: "", attributes: {} };

  const first = args[0];
  if (typeof first === "string") {
    return { body: formatBody(first, args.slice(1)), attributes: {} };
  }
  if (first instanceof Error) {
    return {
      body: first.message,
      attributes: {
        "exception.type": first.name,
        "exception.message": first.message,
        "exception.stacktrace": first.stack ?? "",
      },
    };
  }
  if (first && typeof first === "object") {
    const second = args[1];
    const attributes = flattenAttributes(first as Record<string, unknown>);
    if (typeof second === "string") {
      return { body: formatBody(second, args.slice(2)), attributes };
    }
    return { body: "", attributes };
  }
  return { body: String(first), attributes: {} };
}

function formatBody(template: string, rest: unknown[]): string {
  if (rest.length === 0) return template;
  return rest.reduce<string>((acc, arg) => `${acc} ${stringifyArg(arg)}`, template);
}

function stringifyArg(arg: unknown): string {
  if (arg == null) return "";
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return "[unserializable]";
  }
}

function severityFromLevel(level: number): [SeverityNumber, string] {
  for (const [threshold, num, text] of SEVERITY_BY_LEVEL) {
    if (level >= threshold) return [num, text];
  }
  return [SeverityNumber.TRACE, "TRACE"];
}

function flattenAttributes(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (v instanceof Error) {
      out[`${k}.message`] = v.message;
      out[`${k}.stack`] = v.stack ?? "";
      out[`${k}.name`] = v.name;
    } else {
      try {
        out[k] = JSON.stringify(v);
      } catch {
        out[k] = "[unserializable]";
      }
    }
  }
  return out;
}

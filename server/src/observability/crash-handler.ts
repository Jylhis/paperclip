import type { Logger } from "pino";

export interface CrashHandlerOptions {
  logger: Logger;
  /** Optional hook fired with a crash span emit before the process exits. */
  onCrash?: (input: {
    error: unknown;
    source: "uncaughtException" | "unhandledRejection";
  }) => Promise<void>;
  /** Max time we'll wait for `onCrash` to flush telemetry before exit. */
  flushDeadlineMs?: number;
  /** Allows tests to swap the exit function. Production uses `process.exit`. */
  exit?: (code: number) => never;
}

/**
 * Install crash handlers that synchronously log the error, run the optional
 * onCrash flush (which is where the OTel crash span + exporter flush lives),
 * and then exit. Installed even when telemetry exporters are disabled — the
 * stderr log is still useful and an unhandled rejection should not silently
 * leave the process in an inconsistent state.
 *
 * Idempotent: calling this twice is harmless, the second registration is a
 * no-op. This makes it safe to install before exporter wiring.
 */
let installed = false;

export function installCrashHandler(opts: CrashHandlerOptions): void {
  if (installed) return;
  installed = true;

  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const flushDeadline = opts.flushDeadlineMs ?? 3000;

  let crashing = false;

  const handle = async (
    error: unknown,
    source: "uncaughtException" | "unhandledRejection",
  ): Promise<void> => {
    if (crashing) {
      // A second fatal during shutdown — just escalate.
      opts.logger.fatal({ err: error, source }, "paperclip received a second fatal during crash shutdown");
      exit(1);
      return;
    }
    crashing = true;

    opts.logger.fatal(
      {
        err: error instanceof Error ? error : new Error(String(error)),
        source,
      },
      "paperclip is crashing",
    );

    if (opts.onCrash) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), flushDeadline);
        timer.unref?.();
      });
      try {
        const outcome = await Promise.race<"ok" | "timeout">([
          opts.onCrash({ error, source }).then(() => "ok"),
          timeout,
        ]);
        if (outcome === "timeout") {
          opts.logger.error(
            { flushDeadlineMs: flushDeadline, source },
            "crash telemetry flush timed out; some crash spans may be missing",
          );
        }
      } catch (flushErr) {
        opts.logger.error({ err: flushErr }, "crash telemetry flush failed");
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    exit(1);
  };

  process.on("uncaughtException", (err) => {
    void handle(err, "uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    void handle(reason, "unhandledRejection");
  });
}

/** Test-only: lets the unit test reset the singleton between runs. */
export function _resetCrashHandlerForTesting(): void {
  installed = false;
}

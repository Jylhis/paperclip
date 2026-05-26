import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { _resetCrashHandlerForTesting, installCrashHandler } from "../../observability/crash-handler.js";

function silentLogger() {
  return pino({ level: "silent" });
}

describe("installCrashHandler", () => {
  afterEach(() => {
    _resetCrashHandlerForTesting();
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
  });

  it("invokes onCrash and exits non-zero on uncaughtException", async () => {
    const exit = vi.fn();
    const onCrash = vi.fn().mockResolvedValue(undefined);
    installCrashHandler({
      logger: silentLogger(),
      onCrash,
      flushDeadlineMs: 50,
      exit: exit as unknown as (code: number) => never,
    });

    process.emit("uncaughtException", new Error("boom"));
    // Allow the async handler chain to settle.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(onCrash.mock.calls[0][0]).toMatchObject({ source: "uncaughtException" });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("times out gracefully when onCrash hangs", async () => {
    const exit = vi.fn();
    const onCrash = vi.fn(() => new Promise(() => {})); // never resolves
    installCrashHandler({
      logger: silentLogger(),
      onCrash,
      flushDeadlineMs: 30,
      exit: exit as unknown as (code: number) => never,
    });

    process.emit("uncaughtException", new Error("hang"));
    await new Promise((r) => setTimeout(r, 80));

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("is idempotent — second install is a no-op", () => {
    const exit1 = vi.fn();
    const exit2 = vi.fn();
    installCrashHandler({
      logger: silentLogger(),
      exit: exit1 as unknown as (code: number) => never,
    });
    installCrashHandler({
      logger: silentLogger(),
      exit: exit2 as unknown as (code: number) => never,
    });
    process.emit("uncaughtException", new Error("idem"));

    return new Promise((resolve) => setImmediate(resolve)).then(() => {
      expect(exit1).toHaveBeenCalled();
      expect(exit2).not.toHaveBeenCalled();
    });
  });
});

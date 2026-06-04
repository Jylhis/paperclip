import { describe, expect, it, vi } from "vitest";
import type { PluginEvent } from "@paperclipai/plugin-sdk";
import type { PluginEventBus } from "../services/plugin-event-bus.js";
import { setPluginEventBus, logActivity } from "../services/activity-log.js";

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => ({
    getGeneral: () =>
      Promise.resolve({
        censorUsernameInLogs: false,
      }),
  }),
}));

describe("activity log fork telemetry", () => {
  it("emits fork telemetry event with expected naming and payload fields", async () => {
    const companyId = "c7f3b2e1-7f2d-4d4b-8ea1-1d2d5a1a2c99";
    const actorId = "a6b6d2e2-9c35-4f9a-8f57-e8c5e0f4e77a";
    const issueId = "f6b2e3a1-6a8f-4f31-b6a1-8a4c5f7a3d77";
    const requestId = "req-abc123";
    const emittedEvents: PluginEvent[] = [];

    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as {
      insert: (table: unknown) => { values: (value: unknown) => Promise<void> };
    };

    const pluginEventBus: PluginEventBus = {
      emit: vi.fn(async (event: PluginEvent) => {
        emittedEvents.push(event);
        return { errors: [] };
      }),
      forPlugin: () => {
        throw new Error("Unsupported in telemetry test harness");
      },
      clearPlugin: () => {},
      subscriptionCount: () => 0,
    };
    setPluginEventBus(pluginEventBus);

    await logActivity(db, {
      companyId,
      actorType: "agent",
      actorId,
      action: "issue.updated",
      entityType: "issue",
      entityId: issueId,
      requestId,
      elapsedMs: 184,
      result: "succeeded",
    });

    const forkEvent = emittedEvents.find((event) =>
      String(event.eventType).startsWith("jylhis.paperclip_fork."),
    );

    expect(forkEvent).toBeDefined();
    expect(forkEvent?.eventType).toBe("jylhis.paperclip_fork.issue.issue_updated.succeeded");

    const payload = forkEvent?.payload;
    expect(payload).toMatchObject({
      event_version: "v1",
      company_id: companyId,
      actor_id: actorId,
      actor_type: "agent",
      entity_id: issueId,
      request_id: requestId,
      elapsed_ms: 184,
    });

    expect(emittedEvents.some((event) => event.eventType === "issue.updated")).toBe(true);
  });
});

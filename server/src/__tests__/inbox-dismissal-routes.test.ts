import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDismissalService = vi.hoisted(() => ({
  dismiss: vi.fn(),
  list: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  inboxDismissalService: () => mockDismissalService,
  logActivity: mockLogActivity,
}));

async function createApp(
  actor: Record<string, unknown> = {
    type: "board",
    userId: "user-1",
    companyIds: ["company-1"],
    source: "session",
    isInstanceAdmin: false,
  },
) {
  vi.resetModules();
  const [{ errorHandler }, { inboxDismissalRoutes }] = await Promise.all([
    import("../middleware/index.js") as Promise<typeof import("../middleware/index.js")>,
    import("../routes/inbox-dismissals.js") as Promise<typeof import("../routes/inbox-dismissals.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      ...actor,
      companyIds: Array.isArray(actor.companyIds) ? [...actor.companyIds] : actor.companyIds,
    };
    next();
  });
  app.use("/api", inboxDismissalRoutes({} as any));
  app.use(errorHandler);
  return app;
}

async function requestApp(
  app: express.Express,
  buildRequest: (baseUrl: string) => request.Test,
) {
  const { createServer } = await vi.importActual<typeof import("node:http")>("node:http");
  const server = createServer(app);
  try {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server to listen on a TCP port");
    }
    return await buildRequest(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
}

describe("inbox dismissal routes", () => {
  beforeEach(() => {
    mockLogActivity.mockReset().mockResolvedValue(undefined);
    mockDismissalService.dismiss.mockReset();
    mockDismissalService.list.mockReset();
  });

  it("does not include userId, itemKey, or dismissedAt in the activity log details", async () => {
    const dismissedAt = new Date("2026-06-03T12:00:00.000Z");
    mockDismissalService.dismiss.mockResolvedValue({
      itemKey: "join:some-uuid",
      dismissedAt,
    });

    const app = await createApp();
    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .post("/api/companies/company-1/inbox-dismissals")
        .send({ itemKey: "join:some-uuid" }),
    );

    expect(res.status).toBe(201);
    expect(mockLogActivity).toHaveBeenCalledOnce();
    const logCall = mockLogActivity.mock.calls[0]?.[1];
    expect(logCall).toBeDefined();
    expect(logCall.action).toBe("inbox.dismissed");
    expect(logCall.details).toEqual({});
    expect(logCall.details).not.toHaveProperty("userId");
    expect(logCall.details).not.toHaveProperty("itemKey");
    expect(logCall.details).not.toHaveProperty("dismissedAt");
  });

  it("requires board authentication for creating dismissals", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
    });

    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .post("/api/companies/company-1/inbox-dismissals")
        .send({ itemKey: "approval:some-uuid" }),
    );

    expect(res.status).toBe(403);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("rejects dismissal requests with invalid item key format", async () => {
    const app = await createApp();

    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .post("/api/companies/company-1/inbox-dismissals")
        .send({ itemKey: "invalid-key" }),
    );

    expect(res.status).toBe(422);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});

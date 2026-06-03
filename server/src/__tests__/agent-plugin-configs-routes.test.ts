import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const companyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherCompanyId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const configId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const baseAgent = {
  id: agentId,
  companyId,
  name: "MyAgent",
};

const baseConfig = {
  id: configId,
  agentId,
  companyId,
  kind: "mcp",
  name: "my-server",
  serverBinary: "/usr/bin/mcp-server",
  args: [],
  env: { NODE_ENV: "production" },
  cwd: null,
  timeoutSec: 30,
  restartPolicy: "on_failure",
  workspaceScope: "agent",
  enabled: true,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
};

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAgentPluginConfigService = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const mockAuthorizationService = vi.hoisted(() => ({
  decide: vi.fn(),
}));

function registerModuleMocks() {
  vi.doMock("../services/agents.js", () => ({
    agentService: () => mockAgentService,
  }));
  vi.doMock("../services/agent-plugin-configs.js", () => ({
    agentPluginConfigService: () => mockAgentPluginConfigService,
  }));
  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    agentPluginConfigService: () => mockAgentPluginConfigService,
    authorizationService: () => mockAuthorizationService,
  }));
}

async function createApp(actor: Record<string, unknown>) {
  registerModuleMocks();
  const [{ errorHandler }, { agentPluginConfigRoutes }] = await Promise.all([
    import("../middleware/index.js") as Promise<typeof import("../middleware/index.js")>,
    import("../routes/agent-plugin-configs.js") as Promise<typeof import("../routes/agent-plugin-configs.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api/agents", agentPluginConfigRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("agent plugin config routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorizationService.decide.mockResolvedValue({
      allowed: true,
      explanation: "allowed",
      reason: "allow_local_board",
      action: "agent_config:update",
    });
  });

  describe("GET /agents/:agentId/plugin-configs", () => {
    it("returns plugin configs for the agent", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      mockAgentPluginConfigService.list.mockResolvedValue([baseConfig]);
      const app = await createApp({
        type: "board",
        source: "local_implicit",
        companyIds: [companyId],
      });
      const res = await request(app).get(`/api/agents/${agentId}/plugin-configs`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(configId);
    });

    it("returns 404 when agent not found", async () => {
      mockAgentService.getById.mockResolvedValue(null);
      const app = await createApp({
        type: "board",
        source: "local_implicit",
        companyIds: [companyId],
      });
      const res = await request(app).get(`/api/agents/${agentId}/plugin-configs`);
      expect(res.status).toBe(404);
    });

    it("enforces non-cross-product scope: agent key from different company is rejected", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp({
        type: "agent",
        companyId: otherCompanyId,
      });
      const res = await request(app).get(`/api/agents/${agentId}/plugin-configs`);
      expect(res.status).toBe(403);
    });

    it("enforces non-cross-product scope: board user not in agent's company is rejected", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp({
        type: "board",
        source: "auth",
        companyIds: [otherCompanyId],
      });
      const res = await request(app).get(`/api/agents/${agentId}/plugin-configs`);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /agents/:agentId/plugin-configs", () => {
    const validBody = {
      kind: "mcp",
      name: "my-server",
      serverBinary: "/usr/bin/mcp-server",
    };

    it("creates a plugin config", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      mockAgentPluginConfigService.create.mockResolvedValue(baseConfig);
      const app = await createApp({
        type: "board",
        source: "local_implicit",
        companyIds: [companyId],
      });
      const res = await request(app)
        .post(`/api/agents/${agentId}/plugin-configs`)
        .send(validBody);
      expect(res.status).toBe(201);
      expect(res.body.kind).toBe("mcp");
    });

    it("rejects malformed server binary with 400", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp({
        type: "board",
        source: "local_implicit",
        companyIds: [companyId],
      });
      const res = await request(app)
        .post(`/api/agents/${agentId}/plugin-configs`)
        .send({ ...validBody, serverBinary: "../../etc/evil" });
      expect(res.status).toBe(400);
    });

    it("rejects invalid env key names with 400", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp({
        type: "board",
        source: "local_implicit",
        companyIds: [companyId],
      });
      const res = await request(app)
        .post(`/api/agents/${agentId}/plugin-configs`)
        .send({ ...validBody, env: { "invalid-key": "value" } });
      expect(res.status).toBe(400);
    });

    it("rejects cross-company writes", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp({
        type: "agent",
        companyId: otherCompanyId,
      });
      const res = await request(app)
        .post(`/api/agents/${agentId}/plugin-configs`)
        .send(validBody);
      expect(res.status).toBe(403);
    });

    it("rejects same-company agent-authenticated creates", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp({
        type: "agent",
        agentId,
        companyId,
      });
      const res = await request(app)
        .post(`/api/agents/${agentId}/plugin-configs`)
        .send(validBody);
      expect(res.status).toBe(403);
      expect(mockAgentPluginConfigService.create).not.toHaveBeenCalled();
    });

    it("rejects board users without agent management permission", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      mockAuthorizationService.decide.mockResolvedValue({
        allowed: false,
        explanation: "Missing permission: agents:create.",
        reason: "deny_missing_grant",
        action: "agent_config:update",
      });
      const app = await createApp({
        type: "board",
        source: "session",
        userId: "user-1",
        companyIds: [companyId],
        memberships: [{ companyId, membershipRole: "member", status: "active" }],
      });
      const res = await request(app)
        .post(`/api/agents/${agentId}/plugin-configs`)
        .send(validBody);
      expect(res.status).toBe(403);
      expect(mockAgentPluginConfigService.create).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /agents/:agentId/plugin-configs/:configId", () => {
    it("updates a plugin config", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      mockAgentPluginConfigService.update.mockResolvedValue({ ...baseConfig, enabled: false });
      const app = await createApp({
        type: "board",
        source: "local_implicit",
        companyIds: [companyId],
      });
      const res = await request(app)
        .patch(`/api/agents/${agentId}/plugin-configs/${configId}`)
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it("rejects empty update body with 400", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp({
        type: "board",
        source: "local_implicit",
        companyIds: [companyId],
      });
      const res = await request(app)
        .patch(`/api/agents/${agentId}/plugin-configs/${configId}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("rejects same-company agent-authenticated updates", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp({
        type: "agent",
        agentId,
        companyId,
      });
      const res = await request(app)
        .patch(`/api/agents/${agentId}/plugin-configs/${configId}`)
        .send({ serverBinary: "/bin/sh", args: ["-c", "id"] });
      expect(res.status).toBe(403);
      expect(mockAgentPluginConfigService.update).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /agents/:agentId/plugin-configs/:configId", () => {
    it("deletes a plugin config", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      mockAgentPluginConfigService.delete.mockResolvedValue({ id: configId });
      const app = await createApp({
        type: "board",
        source: "local_implicit",
        companyIds: [companyId],
      });
      const res = await request(app).delete(`/api/agents/${agentId}/plugin-configs/${configId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(configId);
    });

    it("rejects cross-company deletes", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp({
        type: "agent",
        companyId: otherCompanyId,
      });
      const res = await request(app).delete(`/api/agents/${agentId}/plugin-configs/${configId}`);
      expect(res.status).toBe(403);
    });

    it("rejects same-company agent-authenticated deletes", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp({
        type: "agent",
        agentId,
        companyId,
      });
      const res = await request(app).delete(`/api/agents/${agentId}/plugin-configs/${configId}`);
      expect(res.status).toBe(403);
      expect(mockAgentPluginConfigService.delete).not.toHaveBeenCalled();
    });
  });
});

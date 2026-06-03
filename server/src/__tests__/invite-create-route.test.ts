import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logActivityMock = vi.fn();
const accessServiceMock = {
  isInstanceAdmin: vi.fn(),
  canUser: vi.fn(),
  hasPermission: vi.fn(),
};

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    accessService: () => accessServiceMock,
    agentService: () => ({
      getById: vi.fn(),
    }),
    boardAuthService: () => ({
      createChallenge: vi.fn(),
      resolveBoardAccess: vi.fn(),
      assertCurrentBoardKey: vi.fn(),
      revokeBoardApiKey: vi.fn(),
    }),
    deduplicateAgentName: vi.fn(),
    logActivity: (...args: unknown[]) => logActivityMock(...args),
    notifyHireApproved: vi.fn(),
  }));
}

function createDbStub() {
  const insertedValues: unknown[] = [];
  const createdInvite = {
    id: "invite-1",
    companyId: "company-1",
    inviteType: "company_join",
    allowedJoinTypes: "human",
    tokenHash: "hash",
    defaultsPayload: { humanRole: "viewer" },
    expiresAt: new Date("2027-03-10T00:00:00.000Z"),
    invitedByUserId: null,
    revokedAt: null,
    acceptedAt: null,
    createdAt: new Date("2026-03-07T00:00:00.000Z"),
    updatedAt: new Date("2026-03-07T00:00:00.000Z"),
  };

  return {
    insertedValues,
    insert() {
      return {
        values(value: unknown) {
          insertedValues.push(value);
          return {
            returning() {
              return Promise.resolve([createdInvite]);
            },
          };
        },
      };
    },
    select(_shape?: unknown) {
      return {
        from() {
          const query = {
            leftJoin() {
              return query;
            },
            where() {
              return Promise.resolve([{
                name: "Acme Robotics",
                brandColor: "#114488",
                logoAssetId: "logo-1",
              }]);
            },
          };
          return query;
        },
      };
    },
  };
}

async function createApp(
  options: {
    actor?: Record<string, unknown>;
    db?: ReturnType<typeof createDbStub>;
    deploymentMode?: "local_trusted" | "authenticated";
  } = {},
) {
  const [{ accessRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/access.js"),
    import("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = options.actor ?? {
      type: "board",
      source: "local_implicit",
      userId: null,
      companyIds: ["company-1"],
    };
    next();
  });
  app.use(
    "/api",
    accessRoutes((options.db ?? createDbStub()) as any, {
      deploymentMode: options.deploymentMode ?? "local_trusted",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("POST /companies/:companyId/invites", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/access.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    accessServiceMock.canUser.mockReset();
    accessServiceMock.hasPermission.mockReset();
    accessServiceMock.isInstanceAdmin.mockReset();
    logActivityMock.mockReset();
  });

  it("returns an absolute invite URL using the request base URL", async () => {
    const app = await createApp();

    const res = await request(app)
      .post("/api/companies/company-1/invites")
      .set("host", "paperclip.example")
      .set("x-forwarded-proto", "https")
      .send({
        allowedJoinTypes: "human",
        humanRole: "viewer",
      });

    expect(res.status).toBe(201);
    expect(res.body.companyName).toBe("Acme Robotics");
    expect(res.body.invitePath).toMatch(/^\/invite\/pcp_invite_/);
    expect(res.body.inviteUrl).toMatch(/^https:\/\/paperclip\.example\/invite\/pcp_invite_/);
  });

  it("rejects human invites when the creator cannot approve joins or grant permissions", async () => {
    const db = createDbStub();
    accessServiceMock.canUser.mockImplementation(
      async (_companyId: string, _userId: string, permissionKey: string) =>
        permissionKey === "users:invite",
    );
    const app = await createApp({
      db,
      deploymentMode: "authenticated",
      actor: {
        type: "board",
        source: "session",
        userId: "inviter-user",
        companyIds: ["company-1"],
        memberships: [
          {
            companyId: "company-1",
            membershipRole: "operator",
            status: "active",
          },
        ],
      },
    });

    const res = await request(app)
      .post("/api/companies/company-1/invites")
      .send({
        allowedJoinTypes: "human",
        humanRole: "owner",
      });

    expect(res.status).toBe(403);
    expect(db.insertedValues).toEqual([]);
    expect(accessServiceMock.canUser).toHaveBeenCalledWith(
      "company-1",
      "inviter-user",
      "users:invite",
    );
    expect(accessServiceMock.canUser).toHaveBeenCalledWith(
      "company-1",
      "inviter-user",
      "joins:approve",
    );
  });

  it("allows human invites when the creator can invite, approve joins, and manage permissions", async () => {
    const db = createDbStub();
    accessServiceMock.canUser.mockResolvedValue(true);
    const app = await createApp({
      db,
      deploymentMode: "authenticated",
      actor: {
        type: "board",
        source: "session",
        userId: "owner-user",
        companyIds: ["company-1"],
        memberships: [
          {
            companyId: "company-1",
            membershipRole: "owner",
            status: "active",
          },
        ],
      },
    });

    const res = await request(app)
      .post("/api/companies/company-1/invites")
      .send({
        allowedJoinTypes: "human",
        humanRole: "owner",
      });

    expect(res.status).toBe(201);
    expect(db.insertedValues).toEqual([
      expect.objectContaining({
        allowedJoinTypes: "human",
        defaultsPayload: expect.objectContaining({
          human: expect.objectContaining({
            role: "owner",
            grants: expect.arrayContaining([
              expect.objectContaining({ permissionKey: "users:manage_permissions" }),
              expect.objectContaining({ permissionKey: "joins:approve" }),
            ]),
          }),
        }),
      }),
    ]);
    expect(accessServiceMock.canUser).toHaveBeenCalledWith(
      "company-1",
      "owner-user",
      "users:manage_permissions",
    );
  });
});

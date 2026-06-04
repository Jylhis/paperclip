import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFeedbackService = vi.hoisted(() => ({
  listIssueVotesForUser: vi.fn(),
  saveIssueVote: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
}));

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    accessService: () => ({ canUser: vi.fn(), hasPermission: vi.fn() }),
    agentService: () => ({ getById: vi.fn() }),
    companyService: () => ({ getById: vi.fn(async () => ({ id: "company-1", attachmentMaxBytes: 10 * 1024 * 1024 })) }),
    documentService: () => ({}),
    executionWorkspaceService: () => ({}),
    goalService: () => ({}),
    heartbeatService: () => ({
      wakeup: vi.fn(async () => undefined),
      reportRunActivity: vi.fn(async () => undefined),
      getRun: vi.fn(async () => null),
      getActiveRunForAgent: vi.fn(async () => null),
      cancelRun: vi.fn(async () => null),
    }),
    issueApprovalService: () => ({}),
    issueRecoveryActionService: () => ({
      getActiveForIssue: vi.fn(async () => null),
      listActiveForIssues: vi.fn(async () => new Map()),
    }),
    issueReferenceService: () => ({
      deleteDocumentSource: vi.fn(async () => undefined),
      diffIssueReferenceSummary: vi.fn(() => ({
        addedReferencedIssues: [],
        removedReferencedIssues: [],
        currentReferencedIssues: [],
      })),
      emptySummary: vi.fn(() => ({ outbound: [], inbound: [] })),
      listIssueReferenceSummary: vi.fn(async () => ({ outbound: [], inbound: [] })),
      syncComment: vi.fn(async () => undefined),
      syncDocument: vi.fn(async () => undefined),
      syncIssue: vi.fn(async () => undefined),
    }),
    issueService: () => mockIssueService,
    issueThreadInteractionService: () => ({
      expireRequestConfirmationsSupersededByComment: vi.fn(async () => []),
      expireStaleRequestConfirmationsForIssueDocument: vi.fn(async () => []),
    }),
    logActivity: vi.fn(async () => undefined),
    projectService: () => ({}),
    routineService: () => ({ syncRunStatusForIssue: vi.fn(async () => undefined) }),
    workProductService: () => ({}),
  }));

  vi.doMock("../services/environments.js", () => ({
    environmentService: () => ({ getById: vi.fn(async () => null) }),
  }));

  vi.doMock("../services/execution-workspaces.js", () => ({
    executionWorkspaceService: () => ({}),
  }));

  vi.doMock("../services/feedback.js", () => ({
    feedbackService: () => mockFeedbackService,
  }));

  vi.doMock("../services/instance-settings.js", () => ({
    instanceSettingsService: () => ({
      get: vi.fn(async () => ({
        id: "instance-settings-1",
        general: { censorUsernameInLogs: false, keyboardShortcuts: false, backupRetention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 } },
      })),
      getGeneral: vi.fn(async () => ({
        censorUsernameInLogs: false,
        keyboardShortcuts: false,
        backupRetention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
      })),
      listCompanyIds: vi.fn(async () => ["company-1"]),
    }),
  }));
}

async function createApp(actor: Record<string, unknown>) {
  const [{ issueRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/issues.js"),
    import("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue feedback vote routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../services/environments.js");
    vi.doUnmock("../services/execution-workspaces.js");
    vi.doUnmock("../services/feedback.js");
    vi.doUnmock("../services/instance-settings.js");
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
  });

  it("saves a local-only vote for board users", async () => {
    const targetId = "11111111-1111-4111-8111-111111111111";
    mockIssueService.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockFeedbackService.saveIssueVote.mockResolvedValue({
      vote: {
        id: "vote-1",
        companyId: "company-1",
        issueId: "issue-1",
        targetType: "issue_comment",
        targetId,
        authorUserId: "user-1",
        vote: "down",
        reason: "Too vague",
        redactionSummary: null,
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
        updatedAt: new Date("2026-06-02T00:00:00.000Z"),
      },
    });
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: true,
      companyIds: ["company-1"],
    });

    const res = await request(app)
      .post("/api/issues/issue-1/feedback-votes")
      .send({
        targetType: "issue_comment",
        targetId,
        vote: "down",
        reason: "Too vague",
      });

    expect(res.status).toBe(201);
    expect(mockFeedbackService.saveIssueVote).toHaveBeenCalledWith({
      issueId: "issue-1",
      targetType: "issue_comment",
      targetId,
      vote: "down",
      reason: "Too vague",
      authorUserId: "user-1",
    });
  });

  it("rejects agent callers for feedback votes", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/issues/issue-1/feedback-votes")
      .send({
        targetType: "issue_comment",
        targetId: "11111111-1111-4111-8111-111111111111",
        vote: "up",
      });

    expect(res.status).toBe(403);
    expect(mockFeedbackService.saveIssueVote).not.toHaveBeenCalled();
  });
});

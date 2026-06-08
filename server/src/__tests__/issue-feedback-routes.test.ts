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
  update: vi.fn(),
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));
const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));
const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(async () => ({
    id: "instance-settings-1",
    general: {
      censorUsernameInLogs: false,
    },
  })),
  listCompanyIds: vi.fn(async () => ["company-1"]),
}));
const mockRoutineService = vi.hoisted(() => ({
  syncRunStatusForIssue: vi.fn(async () => undefined),
}));
const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));
const mockIssueThreadInteractionService = vi.hoisted(() => ({
  expireRequestConfirmationsSupersededByComment: vi.fn(async () => []),
  expireStaleRequestConfirmationsForIssueDocument: vi.fn(async () => []),
}));
const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(async () => null),
}));
const mockExecutionWorkspaceService = vi.hoisted(() => ({}));
const mockIssueReferenceService = vi.hoisted(() => ({
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
}));

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    companyService: () => ({
      getById: vi.fn(async () => ({ id: "company-1", attachmentMaxBytes: 10 * 1024 * 1024 })),
    }),
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    documentService: () => ({}),
    executionWorkspaceService: () => mockExecutionWorkspaceService,
    goalService: () => ({}),
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => ({}),
    issueReferenceService: () => mockIssueReferenceService,
    issueRecoveryActionService: () => ({
      getActiveForIssue: vi.fn(async () => null),
      listActiveForIssues: vi.fn(async () => new Map()),
    }),
    issueService: () => mockIssueService,
    issueThreadInteractionService: () => mockIssueThreadInteractionService,
    logActivity: mockLogActivity,
    projectService: () => ({}),
    routineService: () => mockRoutineService,
    workProductService: () => ({}),
  }));

  vi.doMock("../services/environments.js", () => ({
    environmentService: () => mockEnvironmentService,
  }));

  vi.doMock("../services/execution-workspaces.js", () => ({
    executionWorkspaceService: () => mockExecutionWorkspaceService,
  }));

  vi.doMock("../services/feedback.js", () => ({
    feedbackService: () => mockFeedbackService,
  }));

  vi.doMock("../services/instance-settings.js", () => ({
    instanceSettingsService: () => mockInstanceSettingsService,
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
  app.use("/api", issueRoutes({} as any, {} as any, {}));
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
    mockHeartbeatService.wakeup.mockResolvedValue(undefined);
    mockHeartbeatService.reportRunActivity.mockResolvedValue(undefined);
    mockHeartbeatService.getRun.mockResolvedValue(null);
    mockHeartbeatService.getActiveRunForAgent.mockResolvedValue(null);
    mockHeartbeatService.cancelRun.mockResolvedValue(null);
    mockRoutineService.syncRunStatusForIssue.mockResolvedValue(undefined);
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("saves a local vote and logs the feedback_vote_saved activity", async () => {
    const targetId = "11111111-1111-4111-8111-111111111111";
    mockIssueService.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockFeedbackService.saveIssueVote.mockResolvedValue({
      vote: {
        targetType: "issue_comment",
        targetId,
        vote: "up",
        reason: null,
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
        vote: "up",
      });

    expect([200, 201]).toContain(res.status);
    expect(mockFeedbackService.saveIssueVote).toHaveBeenCalledWith({
      issueId: "issue-1",
      targetType: "issue_comment",
      targetId,
      vote: "up",
      reason: undefined,
      authorUserId: "user-1",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.feedback_vote_saved",
        entityType: "issue",
        entityId: "issue-1",
      }),
    );
  });

  it("rejects non-board callers from voting", async () => {
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

  it("lists feedback votes for the requesting board user", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      identifier: "PAP-1",
    });
    mockFeedbackService.listIssueVotesForUser.mockResolvedValue([
      { id: "vote-1", vote: "up" },
    ]);
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: true,
      companyIds: ["company-1"],
    });

    const res = await request(app).get("/api/issues/issue-1/feedback-votes");
    expect(res.status).toBe(200);
    expect(mockFeedbackService.listIssueVotesForUser).toHaveBeenCalledWith("issue-1", "user-1");
  });
});

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  companies,
  companySkills,
  costEvents,
  createDb,
  documents,
  documentRevisions,
  feedbackVotes,
  heartbeatRuns,
  instanceSettings,
  issueComments,
  issueDocuments,
  issues,
} from "@paperclipai/db";
import { feedbackService } from "../services/feedback.ts";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.ts";

async function closeDbClient(db: ReturnType<typeof createDb> | undefined) {
  await db?.$client?.end?.({ timeout: 0 });
}

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping feedbackService embedded Postgres tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("feedbackService.saveIssueVote", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof feedbackService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let tempDirs: string[] = [];

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("paperclip-feedback-service-");
    db = createDb(started.connectionString);
    svc = feedbackService(db);
    tempDb = started;
  }, 120_000);

  afterEach(async () => {
    await db.delete(feedbackVotes);
    await db.delete(instanceSettings);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issueComments);
    await db.delete(costEvents);
    await db.delete(heartbeatRuns);
    await db.delete(companySkills);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
    tempDirs = [];
  });

  afterAll(async () => {
    await closeDbClient(db);
    await tempDb?.cleanup();
  });

  async function seedIssueWithAgentComment() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const commentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `F${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Add feedback voting",
      status: "todo",
      priority: "medium",
      createdByUserId: "user-1",
    });

    await db.insert(issueComments).values({
      id: commentId,
      companyId,
      issueId,
      authorAgentId: agentId,
      body: "AI generated update",
    });

    return { companyId, issueId, commentId };
  }

  async function seedIssueWithAgentDocument() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const documentId = randomUUID();
    const revisionId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `D${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Document feedback",
      status: "todo",
      priority: "medium",
      createdByUserId: "user-1",
    });

    await db.insert(documents).values({
      id: documentId,
      companyId,
      title: "Plan",
      format: "markdown",
      latestBody: "Drafted by an agent",
      latestRevisionId: revisionId,
      latestRevisionNumber: 1,
      createdByAgentId: agentId,
      updatedByAgentId: agentId,
    });

    await db.insert(documentRevisions).values({
      id: revisionId,
      companyId,
      documentId,
      revisionNumber: 1,
      body: "Drafted by an agent",
      createdByAgentId: agentId,
    });

    await db.insert(issueDocuments).values({
      companyId,
      issueId,
      documentId,
      key: "plan",
    });

    return { companyId, issueId, revisionId };
  }

  it("stores a local vote and returns it", async () => {
    const { issueId, commentId } = await seedIssueWithAgentComment();

    const result = await svc.saveIssueVote({
      issueId,
      targetType: "issue_comment",
      targetId: commentId,
      vote: "up",
      authorUserId: "user-1",
    });

    expect(result.vote.vote).toBe("up");
    expect(result.vote.reason).toBeNull();

    const votes = await svc.listIssueVotesForUser(issueId, "user-1");
    expect(votes).toHaveLength(1);
    expect(votes[0]?.vote).toBe("up");
  });

  it("does not add any company-level data sharing columns to the company row", async () => {
    const { companyId, issueId, commentId } = await seedIssueWithAgentComment();

    await svc.saveIssueVote({
      issueId,
      targetType: "issue_comment",
      targetId: commentId,
      vote: "up",
      authorUserId: "user-1",
    });

    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);

    expect(company).not.toBeNull();
    const sharingColumns = Object.keys(company as Record<string, unknown>).filter((key) =>
      key.toLowerCase().includes("sharing"),
    );
    expect(sharingColumns).toEqual([]);
  });

  it("upserts an existing vote in place", async () => {
    const { issueId, commentId } = await seedIssueWithAgentComment();

    const first = await svc.saveIssueVote({
      issueId,
      targetType: "issue_comment",
      targetId: commentId,
      vote: "up",
      authorUserId: "user-1",
    });

    const second = await svc.saveIssueVote({
      issueId,
      targetType: "issue_comment",
      targetId: commentId,
      vote: "down",
      reason: "Needed concrete next steps.",
      authorUserId: "user-1",
    });

    expect(second.vote.id).toBe(first.vote.id);
    expect(second.vote.vote).toBe("down");
    expect(second.vote.reason).toBe("Needed concrete next steps.");

    const votes = await svc.listIssueVotesForUser(issueId, "user-1");
    expect(votes).toHaveLength(1);
    expect(votes[0]?.vote).toBe("down");
  });

  it("only stores a downvote reason for down votes", async () => {
    const { issueId, commentId } = await seedIssueWithAgentComment();

    const upWithReason = await svc.saveIssueVote({
      issueId,
      targetType: "issue_comment",
      targetId: commentId,
      vote: "up",
      reason: "Ignored for upvotes",
      authorUserId: "user-1",
    });
    expect(upWithReason.vote.reason).toBeNull();

    const down = await svc.saveIssueVote({
      issueId,
      targetType: "issue_comment",
      targetId: commentId,
      vote: "down",
      reason: "The update missed the edge case handling.",
      authorUserId: "user-1",
    });
    expect(down.vote.reason).toBe("The update missed the edge case handling.");
  });

  it("stores votes for document revision targets", async () => {
    const { issueId, revisionId } = await seedIssueWithAgentDocument();

    const result = await svc.saveIssueVote({
      issueId,
      targetType: "issue_document_revision",
      targetId: revisionId,
      vote: "up",
      authorUserId: "user-1",
    });

    expect(result.vote.vote).toBe("up");
    expect(result.vote.targetType).toBe("issue_document_revision");
    expect(result.vote.targetId).toBe(revisionId);
  });

  it("rejects feedback votes on human-authored comments", async () => {
    const companyId = randomUUID();
    const issueId = randomUUID();
    const commentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `H${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Human-authored comment",
      status: "todo",
      priority: "medium",
      createdByUserId: "user-1",
    });

    await db.insert(issueComments).values({
      id: commentId,
      companyId,
      issueId,
      authorUserId: "user-2",
      body: "Board comment",
    });

    await expect(
      svc.saveIssueVote({
        issueId,
        targetType: "issue_comment",
        targetId: commentId,
        vote: "up",
        authorUserId: "user-1",
      }),
    ).rejects.toThrow("Feedback voting is only available on agent-authored issue comments");
  });
});

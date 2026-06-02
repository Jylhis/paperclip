import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { documentRevisions, documents, feedbackVotes, issueComments, issueDocuments, issues } from "@paperclipai/db";
import type { FeedbackTargetType, FeedbackVoteValue } from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";

function normalizeReason(vote: FeedbackVoteValue, reason: string | null | undefined) {
  if (vote !== "down" || typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveFeedbackTarget(
  db: Pick<Db, "select">,
  issue: { id: string; companyId: string },
  targetType: FeedbackTargetType,
  targetId: string,
) {
  if (targetType === "issue_comment") {
    const targetComment = await db
      .select({
        id: issueComments.id,
        issueId: issueComments.issueId,
        companyId: issueComments.companyId,
        authorAgentId: issueComments.authorAgentId,
      })
      .from(issueComments)
      .where(eq(issueComments.id, targetId))
      .then((rows) => rows[0] ?? null);

    if (!targetComment || targetComment.issueId !== issue.id || targetComment.companyId !== issue.companyId) {
      throw notFound("Feedback target not found");
    }
    if (!targetComment.authorAgentId) {
      throw unprocessable("Feedback voting is only available on agent-authored issue comments");
    }
    return;
  }

  if (targetType === "issue_document_revision") {
    const targetRevision = await db
      .select({
        id: documentRevisions.id,
        companyId: documentRevisions.companyId,
        issueId: issueDocuments.issueId,
        createdByAgentId: documentRevisions.createdByAgentId,
      })
      .from(documentRevisions)
      .innerJoin(documents, eq(documentRevisions.documentId, documents.id))
      .innerJoin(issueDocuments, eq(issueDocuments.documentId, documents.id))
      .where(eq(documentRevisions.id, targetId))
      .then((rows) => rows.find((row) => row.issueId === issue.id) ?? null);

    if (!targetRevision || targetRevision.companyId !== issue.companyId) {
      throw notFound("Feedback target not found");
    }
    if (!targetRevision.createdByAgentId) {
      throw unprocessable("Feedback voting is only available on agent-authored document revisions");
    }
    return;
  }

  throw unprocessable("Unsupported feedback target type");
}

export function feedbackService(db: Db) {
  return {
    listIssueVotesForUser: async (issueId: string, authorUserId: string) =>
      db
        .select()
        .from(feedbackVotes)
        .where(and(eq(feedbackVotes.issueId, issueId), eq(feedbackVotes.authorUserId, authorUserId))),

    saveIssueVote: async (input: {
      issueId: string;
      targetType: FeedbackTargetType;
      targetId: string;
      vote: FeedbackVoteValue;
      authorUserId: string;
      reason?: string | null;
    }) =>
      db.transaction(async (tx) => {
        const issue = await tx
          .select({
            id: issues.id,
            companyId: issues.companyId,
          })
          .from(issues)
          .where(eq(issues.id, input.issueId))
          .then((rows) => rows[0] ?? null);
        if (!issue) throw notFound("Issue not found");

        await resolveFeedbackTarget(tx, issue, input.targetType, input.targetId);

        const normalizedReason = normalizeReason(input.vote, input.reason);
        const now = new Date();
        const [savedVote] = await tx
          .insert(feedbackVotes)
          .values({
            companyId: issue.companyId,
            issueId: issue.id,
            targetType: input.targetType,
            targetId: input.targetId,
            authorUserId: input.authorUserId,
            vote: input.vote,
            reason: normalizedReason,
            redactionSummary: null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              feedbackVotes.companyId,
              feedbackVotes.targetType,
              feedbackVotes.targetId,
              feedbackVotes.authorUserId,
            ],
            set: {
              vote: input.vote,
              reason: normalizedReason,
              redactionSummary: null,
              updatedAt: now,
            },
          })
          .returning();

        return { vote: savedVote };
      }),
  };
}

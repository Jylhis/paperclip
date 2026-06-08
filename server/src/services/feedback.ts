import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  documentRevisions,
  documents,
  feedbackVotes,
  issueComments,
  issueDocuments,
  issues,
} from "@paperclipai/db";
import {
  type FeedbackTargetType,
  type FeedbackVoteValue,
} from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";

type IssueFeedbackContext = {
  id: string;
  companyId: string;
  projectId: string | null;
  identifier: string | null;
  title: string;
  description: string | null;
};

function normalizeReason(vote: FeedbackVoteValue, reason: string | null | undefined) {
  if (vote !== "down" || typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validates that the feedback target exists, belongs to the issue/company, and is
 * agent-authored. Throws if the target cannot accept a vote.
 */
async function assertFeedbackTarget(
  db: Pick<Db, "select">,
  issue: IssueFeedbackContext,
  targetType: FeedbackTargetType,
  targetId: string,
): Promise<void> {
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
        createdByAgentId: documentRevisions.createdByAgentId,
        issueId: issueDocuments.issueId,
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
            projectId: issues.projectId,
            identifier: issues.identifier,
            title: issues.title,
            description: issues.description,
          })
          .from(issues)
          .where(eq(issues.id, input.issueId))
          .then((rows) => rows[0] ?? null);
        if (!issue) throw notFound("Issue not found");

        await assertFeedbackTarget(tx, issue, input.targetType, input.targetId);

        const now = new Date();
        const normalizedReason = normalizeReason(input.vote, input.reason);

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
              updatedAt: now,
            },
          })
          .returning();

        return {
          vote: savedVote,
        };
      }),
  };
}

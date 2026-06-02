export const FEEDBACK_TARGET_TYPES = ["issue_comment", "issue_document_revision"] as const;
export type FeedbackTargetType = (typeof FEEDBACK_TARGET_TYPES)[number];

export const FEEDBACK_VOTE_VALUES = ["up", "down"] as const;
export type FeedbackVoteValue = (typeof FEEDBACK_VOTE_VALUES)[number];

export interface FeedbackVote {
  id: string;
  companyId: string;
  issueId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  authorUserId: string;
  vote: FeedbackVoteValue;
  reason: string | null;
  redactionSummary: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

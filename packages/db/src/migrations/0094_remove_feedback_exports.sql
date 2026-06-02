ALTER TABLE "feedback_votes" DROP COLUMN IF EXISTS "shared_with_labs";--> statement-breakpoint
ALTER TABLE "feedback_votes" DROP COLUMN IF EXISTS "shared_at";--> statement-breakpoint
ALTER TABLE "feedback_votes" DROP COLUMN IF EXISTS "consent_version";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN IF EXISTS "feedback_data_sharing_enabled";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN IF EXISTS "feedback_data_sharing_consent_at";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN IF EXISTS "feedback_data_sharing_consent_by_user_id";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN IF EXISTS "feedback_data_sharing_terms_version";--> statement-breakpoint
DROP TABLE IF EXISTS "feedback_exports" CASCADE;

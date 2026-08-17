ALTER TABLE "prevention_committee_agreements" DROP CONSTRAINT "prevention_committee_agreement_status_valid";--> statement-breakpoint
ALTER TABLE "prevention_committee_meetings" DROP CONSTRAINT "prevention_committee_meeting_status_valid";--> statement-breakpoint
DROP INDEX "prevention_committee_agreement_meeting_idx";--> statement-breakpoint
CREATE INDEX "prevention_committee_agreement_meeting_idx" ON "prevention_committee_agreements" USING btree ("meeting_id");--> statement-breakpoint
ALTER TABLE "prevention_committee_agreements" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "prevention_committee_members" DROP COLUMN "term_ends_on";--> statement-breakpoint
ALTER TABLE "prevention_committee_meetings" ADD CONSTRAINT "prevention_committee_meeting_status_valid" CHECK ("prevention_committee_meetings"."status" IN ('scheduled', 'closed', 'cancelled'));
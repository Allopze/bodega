ALTER TABLE "prevention_risk_entries" DROP CONSTRAINT "prevention_risk_entries_inherent_level_valid";--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "inherent_dimensions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ALTER COLUMN "inherent_level" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_inherent_level_valid" CHECK ("prevention_risk_entries"."inherent_level" IS NULL OR "prevention_risk_entries"."inherent_level" IN ('low', 'medium', 'high', 'critical'));
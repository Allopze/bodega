ALTER TABLE "prevention_risk_entries" ADD COLUMN "probability" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "consequence" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "risk_magnitude" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "risk_classification" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "evaluation_divergence" jsonb;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "is_routine" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "specific_workplace" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "exposed_workers_female" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "exposed_workers_male" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "exposed_workers_other" integer;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "control_status_text" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD COLUMN "control_deadline_text" text;--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_probability_valid" CHECK ("prevention_risk_entries"."probability" IS NULL OR "prevention_risk_entries"."probability" IN (1, 2, 4));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_consequence_valid" CHECK ("prevention_risk_entries"."consequence" IS NULL OR "prevention_risk_entries"."consequence" IN (1, 2, 4));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_magnitude_product" CHECK ("prevention_risk_entries"."risk_magnitude" IS NULL OR ("prevention_risk_entries"."probability" IS NOT NULL AND "prevention_risk_entries"."consequence" IS NOT NULL AND "prevention_risk_entries"."risk_magnitude" = "prevention_risk_entries"."probability" * "prevention_risk_entries"."consequence"));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_classification_valid" CHECK ("prevention_risk_entries"."risk_classification" IS NULL OR "prevention_risk_entries"."risk_classification" IN ('tolerable', 'moderado', 'importante', 'intolerable'));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_control_status_text_valid" CHECK ("prevention_risk_entries"."control_status_text" IS NULL OR "prevention_risk_entries"."control_status_text" IN ('controlled', 'partial', 'partial_immediate'));--> statement-breakpoint
ALTER TABLE "prevention_risk_entries" ADD CONSTRAINT "prevention_risk_entries_exposed_workers_valid" CHECK (("prevention_risk_entries"."exposed_workers_female" IS NULL OR "prevention_risk_entries"."exposed_workers_female" >= 0) AND ("prevention_risk_entries"."exposed_workers_male" IS NULL OR "prevention_risk_entries"."exposed_workers_male" >= 0) AND ("prevention_risk_entries"."exposed_workers_other" IS NULL OR "prevention_risk_entries"."exposed_workers_other" >= 0));
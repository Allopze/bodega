ALTER TABLE "prevention_inspection_runs" ADD COLUMN "closing_result" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD COLUMN "closing_restrictions" text;--> statement-breakpoint
ALTER TABLE "prevention_inspection_runs" ADD COLUMN "closing_signatures" jsonb;
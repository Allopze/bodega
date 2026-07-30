ALTER TABLE "pdtp_activities" DROP CONSTRAINT "pdtp_activities_objective_order_check";--> statement-breakpoint
ALTER TABLE "pdtp_programs" DROP CONSTRAINT "pdtp_programs_creation_mode_check";--> statement-breakpoint
DROP INDEX "pdtp_activities_program_objective_idx";--> statement-breakpoint
DROP INDEX "pdtp_programs_year_version_unique";--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "pdtp_activities" SET "display_order" = "n" WHERE "display_order" = 0;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "retired_reason" text;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "retired_effective_from" date;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "retired_by_user_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_params" ADD COLUMN "responsible_slugs" jsonb;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_params" ADD COLUMN "responsible_display" text;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_params" ADD COLUMN "responsible_reason" text;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_retired_by_user_id_users_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pdtp_activities_program_display_order_idx" ON "pdtp_activities" USING btree ("program_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_programs_year_unique" ON "pdtp_programs" USING btree ("year");--> statement-breakpoint
ALTER TABLE "pdtp_activities" DROP COLUMN "objective_order";--> statement-breakpoint
ALTER TABLE "pdtp_activities" DROP COLUMN "objective";--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_display_order_check" CHECK ("pdtp_activities"."display_order" >= 0);--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_status_check" CHECK ("pdtp_activities"."status" IN ('active', 'retired'));--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_retirement_check" CHECK ("pdtp_activities"."status" = 'active' OR (
    length(trim(COALESCE("pdtp_activities"."retired_reason", ''))) >= 10
    AND "pdtp_activities"."retired_effective_from" IS NOT NULL
    AND "pdtp_activities"."retired_at" IS NOT NULL
  ));--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_params" ADD CONSTRAINT "pdtp_activity_worksite_params_responsible_check" CHECK ("pdtp_activity_worksite_params"."responsible_slugs" IS NULL OR (
    jsonb_typeof("pdtp_activity_worksite_params"."responsible_slugs") = 'array'
    AND jsonb_array_length("pdtp_activity_worksite_params"."responsible_slugs") > 0
    AND length(trim(COALESCE("pdtp_activity_worksite_params"."responsible_display", ''))) > 0
    AND length(trim(COALESCE("pdtp_activity_worksite_params"."responsible_reason", ''))) >= 10
  ));--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_creation_mode_check" CHECK ("pdtp_programs"."creation_mode" IN ('blank', 'program_copy', 'template', 'xlsx_import', 'base_2026'));

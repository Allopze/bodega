ALTER TABLE "pdtp_activities" DROP CONSTRAINT "pdtp_activities_objective_order_check";--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "audience_roles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "schedule_mode" text DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "recurrence_rule" jsonb;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "trigger_type" text;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "trigger_description" text;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "due_days" integer;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "evidence_requirement" text;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "indicator_mode" text DEFAULT 'planned_vs_completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "target_value" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "target_unit" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "creation_mode" text DEFAULT 'blank' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "source_program_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "source_content_version" integer;--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_schedule_mode_check" CHECK ("pdtp_activities"."schedule_mode" IN ('scheduled', 'on_demand', 'triggered'));--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_due_days_check" CHECK ("pdtp_activities"."due_days" IS NULL OR "pdtp_activities"."due_days" >= 0);--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_indicator_mode_check" CHECK ("pdtp_activities"."indicator_mode" IN ('planned_vs_completed', 'closed_on_time', 'completed_count', 'not_applicable'));--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_target_value_check" CHECK ("pdtp_activities"."target_value" IS NULL OR "pdtp_activities"."target_value" >= 0);--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_objective_order_check" CHECK ("pdtp_activities"."objective_order" >= 1);--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_creation_mode_check" CHECK ("pdtp_programs"."creation_mode" IN ('blank', 'program_copy', 'template', 'xlsx_import'));
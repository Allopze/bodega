CREATE TABLE "pdtp_activity_worksite_params" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"expected_subject_count" integer,
	"target_coverage_percent" numeric(5, 2),
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pdtp_activity_worksite_params_subject_count_check" CHECK ("pdtp_activity_worksite_params"."expected_subject_count" IS NULL OR "pdtp_activity_worksite_params"."expected_subject_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pdtp_activities" DROP CONSTRAINT "pdtp_activities_indicator_mode_check";--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_exclusions" DROP CONSTRAINT "pdtp_activity_worksite_exclusions_reason_check";--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_params" ADD CONSTRAINT "pdtp_activity_worksite_params_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_params" ADD CONSTRAINT "pdtp_activity_worksite_params_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_worksite_params" ADD CONSTRAINT "pdtp_activity_worksite_params_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_activity_worksite_params_unique" ON "pdtp_activity_worksite_params" USING btree ("activity_id","worksite_id");--> statement-breakpoint
CREATE INDEX "pdtp_activity_worksite_params_worksite_idx" ON "pdtp_activity_worksite_params" USING btree ("worksite_id");--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "prevention_pdtp_activity_indicator_mode_valid" CHECK ("pdtp_activities"."indicator_mode" IN ('planned_vs_completed', 'closed_on_time', 'completed_count', 'not_applicable', 'coverage'));
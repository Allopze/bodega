CREATE TABLE "pdtp_activity_schedule_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"week" integer NOT NULL,
	"planned_quantity" numeric(10, 2) DEFAULT 0 NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule_overrides" ADD CONSTRAINT "pdtp_activity_schedule_overrides_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule_overrides" ADD CONSTRAINT "pdtp_activity_schedule_overrides_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_activity_schedule_overrides" ADD CONSTRAINT "pdtp_activity_schedule_overrides_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_schedule_overrides_activity_scope_period_unique" ON "pdtp_activity_schedule_overrides" USING btree ("activity_id","worksite_id","year","month","week");--> statement-breakpoint
CREATE INDEX "pdtp_schedule_overrides_worksite_year_month_idx" ON "pdtp_activity_schedule_overrides" USING btree ("worksite_id","year","month");
CREATE TABLE "pdtp_execution_deviations" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"week" integer NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"target_month" integer,
	"target_week" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"withdrawn_by_user_id" text,
	"withdrawn_at" timestamp with time zone,
	"withdraw_reason" text,
	CONSTRAINT "pdtp_execution_deviations_month_check" CHECK ("pdtp_execution_deviations"."month" BETWEEN 1 AND 12),
	CONSTRAINT "pdtp_execution_deviations_week_check" CHECK ("pdtp_execution_deviations"."week" BETWEEN 1 AND 4),
	CONSTRAINT "pdtp_execution_deviations_kind_check" CHECK ("pdtp_execution_deviations"."kind" IN ('not_performed', 'not_applicable', 'reprogrammed')),
	CONSTRAINT "pdtp_execution_deviations_reason_check" CHECK (length(trim("pdtp_execution_deviations"."reason")) >= 10),
	CONSTRAINT "pdtp_execution_deviations_status_check" CHECK ("pdtp_execution_deviations"."status" IN ('active', 'withdrawn')),
	CONSTRAINT "pdtp_execution_deviations_target_check" CHECK (("pdtp_execution_deviations"."kind" <> 'reprogrammed') = ("pdtp_execution_deviations"."target_month" IS NULL AND "pdtp_execution_deviations"."target_week" IS NULL)),
	CONSTRAINT "pdtp_execution_deviations_target_not_same_cell_check" CHECK ("pdtp_execution_deviations"."kind" <> 'reprogrammed' OR ("pdtp_execution_deviations"."target_month", "pdtp_execution_deviations"."target_week") <> ("pdtp_execution_deviations"."month", "pdtp_execution_deviations"."week")),
	CONSTRAINT "pdtp_execution_deviations_target_month_check" CHECK ("pdtp_execution_deviations"."target_month" IS NULL OR "pdtp_execution_deviations"."target_month" BETWEEN 1 AND 12),
	CONSTRAINT "pdtp_execution_deviations_target_week_check" CHECK ("pdtp_execution_deviations"."target_week" IS NULL OR "pdtp_execution_deviations"."target_week" BETWEEN 1 AND 4),
	CONSTRAINT "pdtp_execution_deviations_withdrawn_check" CHECK ("pdtp_execution_deviations"."status" <> 'withdrawn' OR ("pdtp_execution_deviations"."withdrawn_by_user_id" IS NOT NULL AND "pdtp_execution_deviations"."withdrawn_at" IS NOT NULL AND length(trim(COALESCE("pdtp_execution_deviations"."withdraw_reason", ''))) >= 10))
);
--> statement-breakpoint
ALTER TABLE "pdtp_execution_deviations" ADD CONSTRAINT "pdtp_execution_deviations_activity_id_pdtp_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."pdtp_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_deviations" ADD CONSTRAINT "pdtp_execution_deviations_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_deviations" ADD CONSTRAINT "pdtp_execution_deviations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_execution_deviations" ADD CONSTRAINT "pdtp_execution_deviations_withdrawn_by_user_id_users_id_fk" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_execution_deviations_cell_active_unique" ON "pdtp_execution_deviations" USING btree ("activity_id","worksite_id","year","month","week") WHERE "pdtp_execution_deviations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "pdtp_execution_deviations_worksite_period_idx" ON "pdtp_execution_deviations" USING btree ("worksite_id","year","month");
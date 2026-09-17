CREATE TABLE "pdtp_period_closures" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" text DEFAULT 'closed' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"digest" text NOT NULL,
	"closed_by_user_id" text NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"close_reason" text NOT NULL,
	"reopened_by_user_id" text,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"distributed_at" timestamp with time zone,
	"distribution_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdtp_period_closures_year_check" CHECK ("pdtp_period_closures"."year" BETWEEN 2024 AND 2100),
	CONSTRAINT "pdtp_period_closures_month_check" CHECK ("pdtp_period_closures"."month" BETWEEN 1 AND 12),
	CONSTRAINT "pdtp_period_closures_status_check" CHECK ("pdtp_period_closures"."status" IN ('closed', 'reopened')),
	CONSTRAINT "pdtp_period_closures_version_check" CHECK ("pdtp_period_closures"."version" >= 1),
	CONSTRAINT "pdtp_period_closures_digest_check" CHECK (length("pdtp_period_closures"."digest") = 64),
	CONSTRAINT "pdtp_period_closures_close_reason_check" CHECK (length(trim("pdtp_period_closures"."close_reason")) >= 10),
	CONSTRAINT "pdtp_period_closures_reopened_check" CHECK ("pdtp_period_closures"."status" <> 'reopened' OR ("pdtp_period_closures"."reopened_by_user_id" IS NOT NULL AND "pdtp_period_closures"."reopened_at" IS NOT NULL AND length(trim(COALESCE("pdtp_period_closures"."reopen_reason", ''))) >= 10))
);
--> statement-breakpoint
ALTER TABLE "pdtp_period_closures" ADD CONSTRAINT "pdtp_period_closures_program_id_pdtp_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."pdtp_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_period_closures" ADD CONSTRAINT "pdtp_period_closures_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_period_closures" ADD CONSTRAINT "pdtp_period_closures_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_period_closures" ADD CONSTRAINT "pdtp_period_closures_reopened_by_user_id_users_id_fk" FOREIGN KEY ("reopened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_period_closures_period_unique" ON "pdtp_period_closures" USING btree ("program_id","worksite_id","year","month");--> statement-breakpoint
CREATE INDEX "pdtp_period_closures_worksite_period_idx" ON "pdtp_period_closures" USING btree ("worksite_id","year","month");
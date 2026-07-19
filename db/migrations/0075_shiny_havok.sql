ALTER TABLE "safety_indicator_periods" ADD COLUMN "status" text DEFAULT 'closed' NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD COLUMN "reopened_by_user_id" text;--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD COLUMN "reopen_reason" text;--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD CONSTRAINT "safety_indicator_periods_reopened_by_user_id_users_id_fk" FOREIGN KEY ("reopened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD CONSTRAINT "safety_indicator_periods_status_check" CHECK ("safety_indicator_periods"."status" IN ('closed', 'reopened'));--> statement-breakpoint
ALTER TABLE "safety_indicator_periods" ADD CONSTRAINT "safety_indicator_periods_reopen_check" CHECK ("safety_indicator_periods"."status" <> 'reopened' OR ("safety_indicator_periods"."reopened_by_user_id" IS NOT NULL AND "safety_indicator_periods"."reopened_at" IS NOT NULL AND "safety_indicator_periods"."reopen_reason" IS NOT NULL));
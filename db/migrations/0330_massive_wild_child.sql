ALTER TABLE "pdtp_programs" ADD COLUMN "year_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "year_closed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "year_close_reason" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_year_closed_by_user_id_users_id_fk" FOREIGN KEY ("year_closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_year_closed_status_check" CHECK ("pdtp_programs"."year_closed_at" IS NULL OR "pdtp_programs"."status" IN ('closed', 'archived'));
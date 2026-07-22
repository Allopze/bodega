ALTER TABLE "pdtp_programs" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "last_reopened_by_user_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "last_reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "last_reopen_reason" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_last_reopened_by_user_id_users_id_fk" FOREIGN KEY ("last_reopened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
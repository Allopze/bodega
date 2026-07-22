ALTER TABLE "pdtp_programs" DROP CONSTRAINT "pdtp_programs_status_check";--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "content_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "content_digest" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "review_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "review_started_by_user_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "review_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "activated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "rejected_by_user_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "archived_by_user_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_review_started_by_user_id_users_id_fk" FOREIGN KEY ("review_started_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_content_version_check" CHECK ("pdtp_programs"."content_version" >= 1);--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_content_digest_check" CHECK ("pdtp_programs"."content_digest" IS NULL OR length("pdtp_programs"."content_digest") = 64);--> statement-breakpoint
ALTER TABLE "pdtp_programs" ADD CONSTRAINT "pdtp_programs_status_check" CHECK ("pdtp_programs"."status" IN ('draft', 'in_review', 'rejected', 'active', 'closed', 'archived'));
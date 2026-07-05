ALTER TABLE "pdtp_executions" ADD COLUMN "rejected_by_user_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "pdtp_executions" ADD CONSTRAINT "pdtp_executions_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
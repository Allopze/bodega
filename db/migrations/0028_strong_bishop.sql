ALTER TABLE "user_invitations" ADD COLUMN "cancelled_at" text;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD COLUMN "cancelled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD COLUMN "replaced_at" text;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD COLUMN "replaced_by_invitation_id" text;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD COLUMN "last_sent_at" text;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD COLUMN "send_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "users" ADD COLUMN "is_temporary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "valid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "substitute_for_user_id" text;
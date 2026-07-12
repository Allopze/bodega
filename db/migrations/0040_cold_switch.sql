ALTER TABLE "user_invitations" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "worker_id" text;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_worker_id_unique" UNIQUE("worker_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_invitations_pending_worker_unique"
  ON "user_invitations" USING btree ("worker_id")
  WHERE "worker_id" IS NOT NULL
    AND "accepted_at" IS NULL
    AND "cancelled_at" IS NULL
    AND "replaced_at" IS NULL;

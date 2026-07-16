ALTER TABLE "sst_evaluation_visits" ADD COLUMN "estado" text DEFAULT 'borrador' NOT NULL;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD COLUMN "closed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD COLUMN "reopened_by_user_id" text;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD COLUMN "reopening_reason" text;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD CONSTRAINT "sst_evaluation_visits_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD CONSTRAINT "sst_evaluation_visits_reopened_by_user_id_users_id_fk" FOREIGN KEY ("reopened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD CONSTRAINT "sst_evaluation_visits_estado_check" CHECK ("sst_evaluation_visits"."estado" IN ('borrador', 'en_revision', 'cerrada'));--> statement-breakpoint
ALTER TABLE "sst_evaluation_visits" ADD CONSTRAINT "sst_evaluation_visits_reopen_check" CHECK (("sst_evaluation_visits"."reopened_at" IS NULL AND "sst_evaluation_visits"."reopened_by_user_id" IS NULL AND "sst_evaluation_visits"."reopening_reason" IS NULL) OR ("sst_evaluation_visits"."reopened_at" IS NOT NULL AND "sst_evaluation_visits"."reopened_by_user_id" IS NOT NULL AND length("sst_evaluation_visits"."reopening_reason") >= 3));
ALTER TABLE "pdtp_import_batches" DROP CONSTRAINT "pdtp_import_batches_status_check";--> statement-breakpoint
DROP INDEX "pdtp_import_batches_program_checksum_unique";--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD COLUMN "schedule_classification_status" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD COLUMN "cancelled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD CONSTRAINT "pdtp_import_batches_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pdtp_import_batches_program_checksum_unique" ON "pdtp_import_batches" USING btree ("program_id","source_checksum_sha256") WHERE "pdtp_import_batches"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "pdtp_activities" ADD CONSTRAINT "pdtp_activities_schedule_classification_check" CHECK ("pdtp_activities"."schedule_classification_status" IN ('confirmed', 'needs_review'));--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD CONSTRAINT "pdtp_import_batches_cancellation_reason_check" CHECK ("pdtp_import_batches"."status" <> 'cancelled' OR length(trim(COALESCE("pdtp_import_batches"."cancellation_reason", ''))) >= 10);--> statement-breakpoint
ALTER TABLE "pdtp_import_batches" ADD CONSTRAINT "pdtp_import_batches_status_check" CHECK ("pdtp_import_batches"."status" IN ('staged', 'applied', 'cancelled', 'rolled_back', 'failed'));
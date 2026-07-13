ALTER TABLE "fuel_tae_submissions" ADD COLUMN "meter_reading_source" text;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD COLUMN "ocr_confidence" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD COLUMN "ocr_processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_meter_reading_source_valid" CHECK ("fuel_tae_submissions"."meter_reading_source" IN ('ocr', 'manual', 'import'));
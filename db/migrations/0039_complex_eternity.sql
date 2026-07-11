ALTER TABLE "pdtp_responsible_catalog" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pdtp_sheets" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
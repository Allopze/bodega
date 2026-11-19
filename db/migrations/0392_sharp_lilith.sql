ALTER TABLE "fleet_gps_alerts" ADD COLUMN "automation_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_gps_alerts" ADD COLUMN "automation_last_error" text;--> statement-breakpoint
ALTER TABLE "fleet_gps_alerts" ADD COLUMN "automation_last_attempt_at" timestamp with time zone;
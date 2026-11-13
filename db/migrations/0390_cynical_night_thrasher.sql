ALTER TABLE "fuel_meter_readings" DROP CONSTRAINT IF EXISTS "fuel_meter_readings_source_valid";--> statement-breakpoint
ALTER TABLE "fleet_gps_device_links" ALTER COLUMN "vehicle_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_gps_device_links" ADD COLUMN "status" text DEFAULT 'linked' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_gps_device_links" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "meters_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fleet_gps_device_links" ADD CONSTRAINT "fleet_gps_device_links_status_valid" CHECK (
    ("fleet_gps_device_links"."status" = 'linked' AND "fleet_gps_device_links"."vehicle_id" IS NOT NULL)
    OR ("fleet_gps_device_links"."status" = 'excluded' AND "fleet_gps_device_links"."vehicle_id" IS NULL AND "fleet_gps_device_links"."reason" IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "fuel_meter_readings" ADD CONSTRAINT "fuel_meter_readings_source_valid" CHECK ("fuel_meter_readings"."source" IN ('copec_tct', 'gps_onway', 'gps_wialon', 'visionlink_api'));
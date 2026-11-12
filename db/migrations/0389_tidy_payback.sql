CREATE TABLE "fleet_gps_device_links" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'wialon' NOT NULL,
	"external_device_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_gps_device_links_provider_valid" CHECK ("fleet_gps_device_links"."provider" IN ('onway', 'wialon'))
);
--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" DROP CONSTRAINT IF EXISTS "fleet_gps_latest_positions_provider_valid";--> statement-breakpoint
ALTER TABLE "fleet_gps_sync_runs" DROP CONSTRAINT IF EXISTS "fleet_gps_sync_runs_provider_valid";--> statement-breakpoint
ALTER TABLE "fuel_meter_readings" DROP CONSTRAINT IF EXISTS "fuel_meter_readings_source_valid";--> statement-breakpoint
ALTER TABLE "fleet_gps_device_links" ADD CONSTRAINT "fleet_gps_device_links_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_device_links" ADD CONSTRAINT "fleet_gps_device_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_gps_device_links_device_unique" ON "fleet_gps_device_links" USING btree ("provider","external_device_id");--> statement-breakpoint
CREATE INDEX "fleet_gps_device_links_vehicle_idx" ON "fleet_gps_device_links" USING btree ("vehicle_id");--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD CONSTRAINT "fleet_gps_latest_positions_provider_valid" CHECK ("fleet_gps_latest_positions"."provider" IN ('onway', 'wialon'));--> statement-breakpoint
ALTER TABLE "fleet_gps_sync_runs" ADD CONSTRAINT "fleet_gps_sync_runs_provider_valid" CHECK ("fleet_gps_sync_runs"."provider" IN ('onway', 'wialon'));--> statement-breakpoint
ALTER TABLE "fuel_meter_readings" ADD CONSTRAINT "fuel_meter_readings_source_valid" CHECK ("fuel_meter_readings"."source" IN ('copec_tct', 'gps_onway', 'gps_wialon'));
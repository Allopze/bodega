CREATE TABLE "fleet_gps_latest_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'onway' NOT NULL,
	"external_device_id" text NOT NULL,
	"external_group_id" text NOT NULL,
	"vehicle_id" text,
	"worksite_id" text,
	"source_plate" text NOT NULL,
	"normalized_plate" text NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"speed_kph" numeric(7, 2) NOT NULL,
	"heading_degrees" numeric(6, 2) NOT NULL,
	"ignition" boolean NOT NULL,
	"source_status" text,
	"observed_at" timestamp with time zone NOT NULL,
	"sync_run_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_gps_latest_positions_provider_valid" CHECK ("fleet_gps_latest_positions"."provider" IN ('onway')),
	CONSTRAINT "fleet_gps_latest_positions_vehicle_scope_consistent" CHECK (
    ("fleet_gps_latest_positions"."vehicle_id" IS NULL AND "fleet_gps_latest_positions"."worksite_id" IS NULL)
    OR ("fleet_gps_latest_positions"."vehicle_id" IS NOT NULL AND "fleet_gps_latest_positions"."worksite_id" IS NOT NULL)
  ),
	CONSTRAINT "fleet_gps_latest_positions_coordinates_valid" CHECK (
    "fleet_gps_latest_positions"."latitude" BETWEEN -90 AND 90 AND "fleet_gps_latest_positions"."longitude" BETWEEN -180 AND 180
  ),
	CONSTRAINT "fleet_gps_latest_positions_motion_valid" CHECK (
    "fleet_gps_latest_positions"."speed_kph" BETWEEN 0 AND 400 AND "fleet_gps_latest_positions"."heading_degrees" >= 0 AND "fleet_gps_latest_positions"."heading_degrees" < 360
  )
);
--> statement-breakpoint
CREATE TABLE "fleet_gps_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'onway' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"actor_user_id" text,
	"devices_received" integer DEFAULT 0 NOT NULL,
	"devices_accepted" integer DEFAULT 0 NOT NULL,
	"devices_rejected" integer DEFAULT 0 NOT NULL,
	"devices_unmatched" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "fleet_gps_sync_runs_provider_valid" CHECK ("fleet_gps_sync_runs"."provider" IN ('onway')),
	CONSTRAINT "fleet_gps_sync_runs_trigger_valid" CHECK ("fleet_gps_sync_runs"."trigger" IN ('manual', 'cron')),
	CONSTRAINT "fleet_gps_sync_runs_status_valid" CHECK ("fleet_gps_sync_runs"."status" IN ('running', 'success', 'partial', 'failed')),
	CONSTRAINT "fleet_gps_sync_runs_counts_valid" CHECK (
    "fleet_gps_sync_runs"."devices_received" >= 0 AND "fleet_gps_sync_runs"."devices_accepted" >= 0
    AND "fleet_gps_sync_runs"."devices_rejected" >= 0 AND "fleet_gps_sync_runs"."devices_unmatched" >= 0
  )
);
--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD CONSTRAINT "fleet_gps_latest_positions_sync_run_id_fleet_gps_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."fleet_gps_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD CONSTRAINT "fleet_gps_latest_positions_vehicle_worksite_fk" FOREIGN KEY ("vehicle_id","worksite_id") REFERENCES "public"."fuel_vehicles"("id","worksite_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fleet_gps_sync_runs" ADD CONSTRAINT "fleet_gps_sync_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_gps_latest_positions_device_unique" ON "fleet_gps_latest_positions" USING btree ("provider","external_device_id");--> statement-breakpoint
CREATE INDEX "fleet_gps_latest_positions_vehicle_idx" ON "fleet_gps_latest_positions" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "fleet_gps_latest_positions_worksite_idx" ON "fleet_gps_latest_positions" USING btree ("worksite_id");--> statement-breakpoint
CREATE INDEX "fleet_gps_latest_positions_plate_idx" ON "fleet_gps_latest_positions" USING btree ("normalized_plate");--> statement-breakpoint
CREATE INDEX "fleet_gps_latest_positions_observed_idx" ON "fleet_gps_latest_positions" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "fleet_gps_sync_runs_started_idx" ON "fleet_gps_sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "fleet_gps_sync_runs_status_idx" ON "fleet_gps_sync_runs" USING btree ("status");
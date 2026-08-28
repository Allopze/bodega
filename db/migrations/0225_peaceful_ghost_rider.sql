CREATE TABLE "fleet_gps_alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'onway' NOT NULL,
	"alert_type" text,
	"category" text NOT NULL,
	"worksite_id" text,
	"destination" text DEFAULT 'none' NOT NULL,
	"owner_user_id" text,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_gps_alert_rules_provider_valid" CHECK ("fleet_gps_alert_rules"."provider" IN ('onway')),
	CONSTRAINT "fleet_gps_alert_rules_destination_valid" CHECK ("fleet_gps_alert_rules"."destination" IN ('none', 'maintenance', 'capa')),
	CONSTRAINT "fleet_gps_alert_rules_cooldown_valid" CHECK ("fleet_gps_alert_rules"."cooldown_minutes" BETWEEN 1 AND 10080)
);
--> statement-breakpoint
CREATE TABLE "fleet_gps_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'onway' NOT NULL,
	"external_device_id" text NOT NULL,
	"external_event_key" text NOT NULL,
	"vehicle_id" text,
	"worksite_id" text,
	"driver_mapping_id" text,
	"alert_type" text NOT NULL,
	"category" text DEFAULT 'unknown' NOT NULL,
	"title" text NOT NULL,
	"priority" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"speed_kph" numeric(7, 2),
	"processing_status" text DEFAULT 'new' NOT NULL,
	"rule_id" text,
	"linked_entity_type" text,
	"linked_entity_id" text,
	"coordinates_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_gps_alerts_provider_valid" CHECK ("fleet_gps_alerts"."provider" IN ('onway')),
	CONSTRAINT "fleet_gps_alerts_scope_consistent" CHECK (("fleet_gps_alerts"."vehicle_id" IS NULL AND "fleet_gps_alerts"."worksite_id" IS NULL) OR ("fleet_gps_alerts"."vehicle_id" IS NOT NULL AND "fleet_gps_alerts"."worksite_id" IS NOT NULL)),
	CONSTRAINT "fleet_gps_alerts_coordinates_valid" CHECK (("fleet_gps_alerts"."latitude" IS NULL AND "fleet_gps_alerts"."longitude" IS NULL) OR ("fleet_gps_alerts"."latitude" BETWEEN -90 AND 90 AND "fleet_gps_alerts"."longitude" BETWEEN -180 AND 180)),
	CONSTRAINT "fleet_gps_alerts_speed_valid" CHECK ("fleet_gps_alerts"."speed_kph" IS NULL OR "fleet_gps_alerts"."speed_kph" BETWEEN 0 AND 400),
	CONSTRAINT "fleet_gps_alerts_status_valid" CHECK ("fleet_gps_alerts"."processing_status" IN ('new', 'actioned', 'ignored', 'blocked')),
	CONSTRAINT "fleet_gps_alerts_link_valid" CHECK (("fleet_gps_alerts"."linked_entity_type" IS NULL AND "fleet_gps_alerts"."linked_entity_id" IS NULL) OR ("fleet_gps_alerts"."linked_entity_type" IN ('maintenance', 'capa') AND "fleet_gps_alerts"."linked_entity_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "fleet_gps_driver_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'onway' NOT NULL,
	"external_driver_hash" text NOT NULL,
	"external_driver_ciphertext" text NOT NULL,
	"display_name_ciphertext" text,
	"worker_id" text NOT NULL,
	"mapped_by_user_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_gps_driver_mappings_provider_valid" CHECK ("fleet_gps_driver_mappings"."provider" IN ('onway'))
);
--> statement-breakpoint
CREATE TABLE "fleet_gps_position_history" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'onway' NOT NULL,
	"external_device_id" text NOT NULL,
	"external_point_key" text NOT NULL,
	"vehicle_id" text,
	"worksite_id" text,
	"driver_mapping_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"speed_kph" numeric(7, 2) NOT NULL,
	"heading_degrees" numeric(6, 2),
	"ignition" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_gps_position_history_provider_valid" CHECK ("fleet_gps_position_history"."provider" IN ('onway')),
	CONSTRAINT "fleet_gps_position_history_scope_consistent" CHECK (("fleet_gps_position_history"."vehicle_id" IS NULL AND "fleet_gps_position_history"."worksite_id" IS NULL) OR ("fleet_gps_position_history"."vehicle_id" IS NOT NULL AND "fleet_gps_position_history"."worksite_id" IS NOT NULL)),
	CONSTRAINT "fleet_gps_position_history_coordinates_valid" CHECK ("fleet_gps_position_history"."latitude" BETWEEN -90 AND 90 AND "fleet_gps_position_history"."longitude" BETWEEN -180 AND 180),
	CONSTRAINT "fleet_gps_position_history_speed_valid" CHECK ("fleet_gps_position_history"."speed_kph" BETWEEN 0 AND 400)
);
--> statement-breakpoint
CREATE TABLE "fleet_gps_trips" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'onway' NOT NULL,
	"external_device_id" text NOT NULL,
	"external_trip_key" text NOT NULL,
	"vehicle_id" text,
	"worksite_id" text,
	"driver_mapping_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"distance_km" numeric(12, 3) NOT NULL,
	"idle_duration" text,
	"movement_duration" text,
	"travel_duration" text,
	"begin_odometer" numeric(14, 2),
	"end_odometer" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_gps_trips_provider_valid" CHECK ("fleet_gps_trips"."provider" IN ('onway')),
	CONSTRAINT "fleet_gps_trips_scope_consistent" CHECK (("fleet_gps_trips"."vehicle_id" IS NULL AND "fleet_gps_trips"."worksite_id" IS NULL) OR ("fleet_gps_trips"."vehicle_id" IS NOT NULL AND "fleet_gps_trips"."worksite_id" IS NOT NULL)),
	CONSTRAINT "fleet_gps_trips_duration_valid" CHECK ("fleet_gps_trips"."ended_at" > "fleet_gps_trips"."started_at"),
	CONSTRAINT "fleet_gps_trips_distance_valid" CHECK ("fleet_gps_trips"."distance_km" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fleet_gps_sync_runs" DROP CONSTRAINT "fleet_gps_sync_runs_counts_valid";--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "gps_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "gprs_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "gps_status" text;--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "gprs_status" text;--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "movement_state" text;--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "odometer" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "hour_meter" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "internal_battery_level" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "external_power_volts" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "engine_rpm" numeric(9, 2);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "coolant_temperature" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "fuel_level" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "temperature_1" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "humidity_1" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD COLUMN "driver_mapping_id" text;--> statement-breakpoint
ALTER TABLE "fleet_gps_sync_runs" ADD COLUMN "alerts_received" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_gps_sync_runs" ADD COLUMN "points_received" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_gps_sync_runs" ADD COLUMN "trips_received" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_gps_alert_rules" ADD CONSTRAINT "fleet_gps_alert_rules_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_alert_rules" ADD CONSTRAINT "fleet_gps_alert_rules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_alerts" ADD CONSTRAINT "fleet_gps_alerts_driver_mapping_id_fleet_gps_driver_mappings_id_fk" FOREIGN KEY ("driver_mapping_id") REFERENCES "public"."fleet_gps_driver_mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_alerts" ADD CONSTRAINT "fleet_gps_alerts_rule_id_fleet_gps_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."fleet_gps_alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_alerts" ADD CONSTRAINT "fleet_gps_alerts_vehicle_worksite_fk" FOREIGN KEY ("vehicle_id","worksite_id") REFERENCES "public"."fuel_vehicles"("id","worksite_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fleet_gps_driver_mappings" ADD CONSTRAINT "fleet_gps_driver_mappings_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_driver_mappings" ADD CONSTRAINT "fleet_gps_driver_mappings_mapped_by_user_id_users_id_fk" FOREIGN KEY ("mapped_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_position_history" ADD CONSTRAINT "fleet_gps_position_history_driver_mapping_id_fleet_gps_driver_mappings_id_fk" FOREIGN KEY ("driver_mapping_id") REFERENCES "public"."fleet_gps_driver_mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_position_history" ADD CONSTRAINT "fleet_gps_position_history_vehicle_worksite_fk" FOREIGN KEY ("vehicle_id","worksite_id") REFERENCES "public"."fuel_vehicles"("id","worksite_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fleet_gps_trips" ADD CONSTRAINT "fleet_gps_trips_driver_mapping_id_fleet_gps_driver_mappings_id_fk" FOREIGN KEY ("driver_mapping_id") REFERENCES "public"."fleet_gps_driver_mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_trips" ADD CONSTRAINT "fleet_gps_trips_vehicle_worksite_fk" FOREIGN KEY ("vehicle_id","worksite_id") REFERENCES "public"."fuel_vehicles"("id","worksite_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "fleet_gps_alert_rules_worksite_idx" ON "fleet_gps_alert_rules" USING btree ("worksite_id","is_enabled");--> statement-breakpoint
CREATE INDEX "fleet_gps_alert_rules_alert_type_idx" ON "fleet_gps_alert_rules" USING btree ("provider","alert_type");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_gps_alerts_external_unique" ON "fleet_gps_alerts" USING btree ("provider","external_device_id","external_event_key");--> statement-breakpoint
CREATE INDEX "fleet_gps_alerts_worksite_status_idx" ON "fleet_gps_alerts" USING btree ("worksite_id","processing_status","occurred_at");--> statement-breakpoint
CREATE INDEX "fleet_gps_alerts_vehicle_occurred_idx" ON "fleet_gps_alerts" USING btree ("vehicle_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_gps_driver_mappings_external_unique" ON "fleet_gps_driver_mappings" USING btree ("provider","external_driver_hash");--> statement-breakpoint
CREATE INDEX "fleet_gps_driver_mappings_worker_idx" ON "fleet_gps_driver_mappings" USING btree ("worker_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_gps_position_history_external_unique" ON "fleet_gps_position_history" USING btree ("provider","external_device_id","external_point_key");--> statement-breakpoint
CREATE INDEX "fleet_gps_position_history_vehicle_occurred_idx" ON "fleet_gps_position_history" USING btree ("vehicle_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fleet_gps_position_history_worksite_occurred_idx" ON "fleet_gps_position_history" USING btree ("worksite_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_gps_trips_external_unique" ON "fleet_gps_trips" USING btree ("provider","external_device_id","external_trip_key");--> statement-breakpoint
CREATE INDEX "fleet_gps_trips_vehicle_started_idx" ON "fleet_gps_trips" USING btree ("vehicle_id","started_at");--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD CONSTRAINT "fleet_gps_latest_positions_driver_mapping_id_fleet_gps_driver_mappings_id_fk" FOREIGN KEY ("driver_mapping_id") REFERENCES "public"."fleet_gps_driver_mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD CONSTRAINT "fleet_gps_latest_positions_battery_valid" CHECK ("fleet_gps_latest_positions"."internal_battery_level" IS NULL OR "fleet_gps_latest_positions"."internal_battery_level" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD CONSTRAINT "fleet_gps_latest_positions_fuel_valid" CHECK ("fleet_gps_latest_positions"."fuel_level" IS NULL OR "fleet_gps_latest_positions"."fuel_level" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "fleet_gps_latest_positions" ADD CONSTRAINT "fleet_gps_latest_positions_humidity_valid" CHECK ("fleet_gps_latest_positions"."humidity_1" IS NULL OR "fleet_gps_latest_positions"."humidity_1" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "fleet_gps_sync_runs" ADD CONSTRAINT "fleet_gps_sync_runs_counts_valid" CHECK (
    "fleet_gps_sync_runs"."devices_received" >= 0 AND "fleet_gps_sync_runs"."devices_accepted" >= 0
    AND "fleet_gps_sync_runs"."devices_rejected" >= 0 AND "fleet_gps_sync_runs"."devices_unmatched" >= 0
    AND "fleet_gps_sync_runs"."alerts_received" >= 0 AND "fleet_gps_sync_runs"."points_received" >= 0 AND "fleet_gps_sync_runs"."trips_received" >= 0
  );
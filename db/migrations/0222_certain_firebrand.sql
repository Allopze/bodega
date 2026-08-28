CREATE TABLE "fuel_meter_readings" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text,
	"plate" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"occurred_at" text NOT NULL,
	"meter_type" text NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"liters" numeric(14, 4),
	"station_name" text,
	"card_number" text,
	"provider_performance" numeric(10, 4),
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_meter_readings_source_valid" CHECK ("fuel_meter_readings"."source" IN ('copec_tct', 'aramco', 'gps_onway')),
	CONSTRAINT "fuel_meter_readings_meter_type_valid" CHECK ("fuel_meter_readings"."meter_type" IN ('odometer', 'hour_meter')),
	CONSTRAINT "fuel_meter_readings_value_positive" CHECK ("fuel_meter_readings"."value" >= 0),
	CONSTRAINT "fuel_meter_readings_liters_positive" CHECK ("fuel_meter_readings"."liters" IS NULL OR "fuel_meter_readings"."liters" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fuel_meter_readings" ADD CONSTRAINT "fuel_meter_readings_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_meter_readings_source_ref_unique" ON "fuel_meter_readings" USING btree ("source","source_ref");--> statement-breakpoint
CREATE INDEX "fuel_meter_readings_series_idx" ON "fuel_meter_readings" USING btree ("vehicle_id","source","meter_type","occurred_at");--> statement-breakpoint
CREATE INDEX "fuel_meter_readings_plate_idx" ON "fuel_meter_readings" USING btree ("plate");--> statement-breakpoint
CREATE INDEX "fuel_meter_readings_occurred_idx" ON "fuel_meter_readings" USING btree ("occurred_at");
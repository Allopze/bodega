CREATE TABLE "fuel_equipment_loads" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"operation_record_id" text,
	"tae_submission_id" text,
	"vehicle_id" text,
	"worksite_id" text NOT NULL,
	"supply_medium_id" text,
	"loading_point_type" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"month" text NOT NULL,
	"liters" numeric(12, 4) NOT NULL,
	"meter_type" text,
	"meter_reading" numeric(14, 2),
	"meter_reset" boolean DEFAULT false NOT NULL,
	"driver_worker_id" text,
	"driver_name" text,
	"supervisor_worker_id" text,
	"supervisor_name" text,
	"anchor_load_id" text,
	"meter_delta" numeric(14, 2),
	"accumulated_liters" numeric(14, 4),
	"performance_unit" text,
	"performance_value" numeric(12, 4),
	"performance_status" text DEFAULT 'not_applicable' NOT NULL,
	"declared_performance" numeric(12, 4),
	"review_status" text DEFAULT 'ok' NOT NULL,
	"flag_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"duplicate_of_id" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_equipment_loads_source_valid" CHECK ("fuel_equipment_loads"."source" IN ('operations_import', 'field', 'legacy_tae')),
	CONSTRAINT "fuel_equipment_loads_source_shape" CHECK (
    ("fuel_equipment_loads"."source" = 'operations_import' AND "fuel_equipment_loads"."operation_record_id" IS NOT NULL AND "fuel_equipment_loads"."tae_submission_id" IS NULL)
    OR ("fuel_equipment_loads"."source" IN ('field', 'legacy_tae') AND "fuel_equipment_loads"."tae_submission_id" IS NOT NULL AND "fuel_equipment_loads"."operation_record_id" IS NULL)
  ),
	CONSTRAINT "fuel_equipment_loads_liters_positive" CHECK ("fuel_equipment_loads"."liters" > 0),
	CONSTRAINT "fuel_equipment_loads_meter_type_valid" CHECK ("fuel_equipment_loads"."meter_type" IS NULL OR "fuel_equipment_loads"."meter_type" IN ('odometer', 'hour_meter')),
	CONSTRAINT "fuel_equipment_loads_unit_valid" CHECK ("fuel_equipment_loads"."performance_unit" IS NULL OR "fuel_equipment_loads"."performance_unit" IN ('km_per_liter', 'liters_per_hour')),
	CONSTRAINT "fuel_equipment_loads_perf_status_valid" CHECK ("fuel_equipment_loads"."performance_status" IN ('computed', 'first_load', 'no_meter', 'meter_regression', 'meter_reset', 'zero_delta', 'not_applicable', 'excluded')),
	CONSTRAINT "fuel_equipment_loads_review_valid" CHECK ("fuel_equipment_loads"."review_status" IN ('ok', 'flagged', 'approved', 'rejected')),
	CONSTRAINT "fuel_equipment_loads_month_format" CHECK ("fuel_equipment_loads"."month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "fuel_mandante_worksites" (
	"worksite_id" text PRIMARY KEY NOT NULL,
	"mandante_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_mandantes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"client_id" text,
	"tolerance_pct" numeric(6, 2) DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_mandantes_tolerance_valid" CHECK ("fuel_mandantes"."tolerance_pct" >= 0 AND "fuel_mandantes"."tolerance_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "fuel_supply_media" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"fuel_supplier_id" text,
	"provider_code" text,
	"provider_channel" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_supply_media_kind_valid" CHECK ("fuel_supply_media"."kind" IN ('card', 'provider_station', 'mandante_dispenser', 'own_tank', 'other')),
	CONSTRAINT "fuel_supply_media_provider_valid" CHECK ("fuel_supply_media"."provider_code" IS NULL OR "fuel_supply_media"."provider_code" IN ('copec', 'aramco')),
	CONSTRAINT "fuel_supply_media_channel_valid" CHECK ("fuel_supply_media"."provider_channel" IS NULL OR "fuel_supply_media"."provider_channel" IN ('TCT', 'TAE'))
);
--> statement-breakpoint
CREATE TABLE "fuel_control_import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"status" text DEFAULT 'imported' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"inserted_rows" integer DEFAULT 0 NOT NULL,
	"updated_rows" integer DEFAULT 0 NOT NULL,
	"rejected_rows" integer DEFAULT 0 NOT NULL,
	"imported_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_control_import_batches_kind_valid" CHECK ("fuel_control_import_batches"."kind" IN ('telemetry', 'supply_inputs')),
	CONSTRAINT "fuel_control_import_batches_status_valid" CHECK ("fuel_control_import_batches"."status" IN ('imported', 'reverted'))
);
--> statement-breakpoint
CREATE TABLE "fuel_control_import_rejections" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_kind" text NOT NULL,
	"batch_id" text NOT NULL,
	"row_index" integer NOT NULL,
	"field" text,
	"message" text NOT NULL,
	"raw_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_control_import_rejections_kind_valid" CHECK ("fuel_control_import_rejections"."batch_kind" IN ('telemetry', 'supply_inputs', 'operations'))
);
--> statement-breakpoint
CREATE TABLE "fuel_supply_inputs" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text,
	"supply_medium_id" text NOT NULL,
	"worksite_id" text NOT NULL,
	"vehicle_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"month" text NOT NULL,
	"liters" numeric(12, 4) NOT NULL,
	"reference" text NOT NULL,
	"raw_row" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_supply_inputs_liters_positive" CHECK ("fuel_supply_inputs"."liters" > 0),
	CONSTRAINT "fuel_supply_inputs_month_format" CHECK ("fuel_supply_inputs"."month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "fuel_telemetry_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text,
	"vehicle_id" text NOT NULL,
	"source" text NOT NULL,
	"day" text NOT NULL,
	"month" text NOT NULL,
	"operating_hours" numeric(8, 2) NOT NULL,
	"idle_hours" numeric(8, 2) NOT NULL,
	"liters_working" numeric(12, 4),
	"liters_idle" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_telemetry_daily_day_format" CHECK ("fuel_telemetry_daily"."day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "fuel_telemetry_daily_hours_valid" CHECK ("fuel_telemetry_daily"."operating_hours" >= 0 AND "fuel_telemetry_daily"."operating_hours" <= 24 AND "fuel_telemetry_daily"."idle_hours" >= 0 AND "fuel_telemetry_daily"."idle_hours" <= "fuel_telemetry_daily"."operating_hours"),
	CONSTRAINT "fuel_telemetry_daily_liters_valid" CHECK (("fuel_telemetry_daily"."liters_working" IS NULL OR "fuel_telemetry_daily"."liters_working" >= 0) AND ("fuel_telemetry_daily"."liters_idle" IS NULL OR "fuel_telemetry_daily"."liters_idle" >= 0))
);
--> statement-breakpoint
ALTER TABLE "fuel_tae_loading_points" DROP CONSTRAINT IF EXISTS "fuel_tae_loading_points_type_valid";--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" DROP CONSTRAINT IF EXISTS "fuel_tae_submissions_source_valid";--> statement-breakpoint
ALTER TABLE "fuel_equipment_types" ADD COLUMN "performance_family" text;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD COLUMN "supply_medium_id" text;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD COLUMN "loaded_at_source" text DEFAULT 'device' NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD COLUMN "registered_by" text;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD COLUMN "seal_chain_status" text DEFAULT 'not_evaluated' NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD COLUMN "seal_chain_expected" text;--> statement-breakpoint
ALTER TABLE "fuel_equipment_loads" ADD CONSTRAINT "fuel_equipment_loads_operation_record_id_fuel_operation_records_id_fk" FOREIGN KEY ("operation_record_id") REFERENCES "public"."fuel_operation_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_equipment_loads" ADD CONSTRAINT "fuel_equipment_loads_tae_submission_id_fuel_tae_submissions_id_fk" FOREIGN KEY ("tae_submission_id") REFERENCES "public"."fuel_tae_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_equipment_loads" ADD CONSTRAINT "fuel_equipment_loads_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_equipment_loads" ADD CONSTRAINT "fuel_equipment_loads_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_equipment_loads" ADD CONSTRAINT "fuel_equipment_loads_supply_medium_id_fuel_supply_media_id_fk" FOREIGN KEY ("supply_medium_id") REFERENCES "public"."fuel_supply_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_equipment_loads" ADD CONSTRAINT "fuel_equipment_loads_driver_worker_id_workers_id_fk" FOREIGN KEY ("driver_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_equipment_loads" ADD CONSTRAINT "fuel_equipment_loads_supervisor_worker_id_workers_id_fk" FOREIGN KEY ("supervisor_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_equipment_loads" ADD CONSTRAINT "fuel_equipment_loads_anchor_load_id_fuel_equipment_loads_id_fk" FOREIGN KEY ("anchor_load_id") REFERENCES "public"."fuel_equipment_loads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_equipment_loads" ADD CONSTRAINT "fuel_equipment_loads_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_equipment_loads" ADD CONSTRAINT "fuel_equipment_loads_duplicate_of_id_fuel_equipment_loads_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."fuel_equipment_loads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_mandante_worksites" ADD CONSTRAINT "fuel_mandante_worksites_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_mandante_worksites" ADD CONSTRAINT "fuel_mandante_worksites_mandante_id_fuel_mandantes_id_fk" FOREIGN KEY ("mandante_id") REFERENCES "public"."fuel_mandantes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_mandantes" ADD CONSTRAINT "fuel_mandantes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_supply_media" ADD CONSTRAINT "fuel_supply_media_fuel_supplier_id_fuel_suppliers_id_fk" FOREIGN KEY ("fuel_supplier_id") REFERENCES "public"."fuel_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_control_import_batches" ADD CONSTRAINT "fuel_control_import_batches_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_supply_inputs" ADD CONSTRAINT "fuel_supply_inputs_batch_id_fuel_control_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fuel_control_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_supply_inputs" ADD CONSTRAINT "fuel_supply_inputs_supply_medium_id_fuel_supply_media_id_fk" FOREIGN KEY ("supply_medium_id") REFERENCES "public"."fuel_supply_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_supply_inputs" ADD CONSTRAINT "fuel_supply_inputs_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_supply_inputs" ADD CONSTRAINT "fuel_supply_inputs_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_telemetry_daily" ADD CONSTRAINT "fuel_telemetry_daily_batch_id_fuel_control_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fuel_control_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_telemetry_daily" ADD CONSTRAINT "fuel_telemetry_daily_vehicle_id_fuel_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."fuel_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_equipment_loads_operation_record_unique" ON "fuel_equipment_loads" USING btree ("operation_record_id") WHERE "fuel_equipment_loads"."operation_record_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_equipment_loads_tae_submission_unique" ON "fuel_equipment_loads" USING btree ("tae_submission_id") WHERE "fuel_equipment_loads"."tae_submission_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fuel_equipment_loads_vehicle_time_idx" ON "fuel_equipment_loads" USING btree ("vehicle_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fuel_equipment_loads_worksite_time_idx" ON "fuel_equipment_loads" USING btree ("worksite_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fuel_equipment_loads_medium_time_idx" ON "fuel_equipment_loads" USING btree ("supply_medium_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fuel_equipment_loads_month_idx" ON "fuel_equipment_loads" USING btree ("month");--> statement-breakpoint
CREATE INDEX "fuel_equipment_loads_review_idx" ON "fuel_equipment_loads" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "fuel_mandante_worksites_mandante_idx" ON "fuel_mandante_worksites" USING btree ("mandante_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_mandantes_name_unique" ON "fuel_mandantes" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_supply_media_slug_unique" ON "fuel_supply_media" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "fuel_control_import_batches_hash_idx" ON "fuel_control_import_batches" USING btree ("kind","file_hash");--> statement-breakpoint
CREATE INDEX "fuel_control_import_rejections_batch_idx" ON "fuel_control_import_rejections" USING btree ("batch_kind","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_supply_inputs_reference_unique" ON "fuel_supply_inputs" USING btree ("supply_medium_id","reference");--> statement-breakpoint
CREATE INDEX "fuel_supply_inputs_worksite_time_idx" ON "fuel_supply_inputs" USING btree ("worksite_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fuel_supply_inputs_medium_time_idx" ON "fuel_supply_inputs" USING btree ("supply_medium_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_telemetry_daily_vehicle_day_source_unique" ON "fuel_telemetry_daily" USING btree ("vehicle_id","day","source");--> statement-breakpoint
CREATE INDEX "fuel_telemetry_daily_month_idx" ON "fuel_telemetry_daily" USING btree ("month");--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_supply_medium_id_fuel_supply_media_id_fk" FOREIGN KEY ("supply_medium_id") REFERENCES "public"."fuel_supply_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_tae_submissions_medium_loaded_idx" ON "fuel_tae_submissions" USING btree ("supply_medium_id","loaded_at");--> statement-breakpoint
ALTER TABLE "fuel_equipment_types" ADD CONSTRAINT "fuel_equipment_types_family_valid" CHECK ("fuel_equipment_types"."performance_family" IS NULL OR "fuel_equipment_types"."performance_family" IN ('camiones', 'cargadores_camionetas', 'maquinaria'));--> statement-breakpoint
ALTER TABLE "fuel_tae_loading_points" ADD CONSTRAINT "fuel_tae_loading_points_type_valid" CHECK ("fuel_tae_loading_points"."type" IN ('fixed_dispenser', 'truck_dispenser', 'pickup_tank', 'jerrycan', 'card_station', 'tae', 'other'));--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_loaded_at_source_valid" CHECK ("fuel_tae_submissions"."loaded_at_source" IN ('server', 'device', 'device_offline', 'import'));--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_seal_chain_valid" CHECK ("fuel_tae_submissions"."seal_chain_status" IN ('not_evaluated', 'ok', 'mismatch', 'no_previous', 'no_seal'));--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_source_valid" CHECK ("fuel_tae_submissions"."source" IN ('public_pwa', 'internal_app', 'legacy_xlsx'));--> statement-breakpoint
-- Catálogo inicial de medios de suministro del tablero de control (TCT, TAE,
-- surtidor CMPC, Aramco, Copec). Es dato de catálogo administrable, no RBAC.
-- Los alias normalizan «Suministro entregado por» del log operacional.
INSERT INTO "fuel_supply_media" ("id", "slug", "name", "kind", "provider_code", "provider_channel", "aliases", "sort_order") VALUES
  ('fsm-tct', 'tct', 'TCT', 'card', 'copec', 'TCT', '["TCT", "COPEC TCT", "TARJETA TCT"]'::jsonb, 10),
  ('fsm-tae', 'tae', 'TAE', 'card', 'copec', 'TAE', '["TAE", "COPEC TAE", "TARJETA TAE"]'::jsonb, 20),
  ('fsm-cmpc', 'cmpc', 'Surtidor CMPC', 'mandante_dispenser', NULL, NULL, '["CMPC", "SURTIDOR CMPC", "SURTIDOR MANDANTE"]'::jsonb, 30),
  ('fsm-aramco', 'aramco', 'Aramco', 'card', 'aramco', NULL, '["ARAMCO", "ARAMCO FLEET", "ESMAX", "PETROBRAS"]'::jsonb, 40),
  ('fsm-copec', 'copec', 'Copec', 'provider_station', NULL, NULL, '["COPEC"]'::jsonb, 50)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "fuel_equipment_types" ("id", "slug", "name", "category", "default_meter_type", "default_performance_unit", "sort_order") VALUES
  ('fet-grua', 'grua', 'Grúa', 'heavy', 'hour_meter', 'liters_per_hour', 140)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
-- Familias de las vistas de rendimiento. Solo se completan las que nadie ha
-- asignado todavía: reaplicar no pisa una decisión tomada en el catálogo.
UPDATE "fuel_equipment_types" SET "performance_family" = 'camiones'
  WHERE "performance_family" IS NULL AND "slug" IN ('camion', 'tracto', 'camion_3_4');
--> statement-breakpoint
UPDATE "fuel_equipment_types" SET "performance_family" = 'cargadores_camionetas'
  WHERE "performance_family" IS NULL AND "slug" IN ('cargador', 'camioneta', 'station_wagon');
--> statement-breakpoint
UPDATE "fuel_equipment_types" SET "performance_family" = 'maquinaria'
  WHERE "performance_family" IS NULL AND "slug" IN ('retroexcavadora', 'excavadora', 'minicargador', 'tractor', 'bulldozer');
--> statement-breakpoint
-- Las cargas importadas del histórico traen la hora de la planilla.
UPDATE "fuel_tae_submissions" SET "loaded_at_source" = 'import'
  WHERE "source" = 'legacy_xlsx' AND "loaded_at_source" = 'device';

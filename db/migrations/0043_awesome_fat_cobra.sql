CREATE TABLE "fuel_equipment_types" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"default_meter_type" text DEFAULT 'none' NOT NULL,
	"default_performance_unit" text DEFAULT 'not_applicable' NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_equipment_types_category_valid" CHECK ("fuel_equipment_types"."category" IN ('truck', 'light', 'heavy', 'storage', 'support', 'other')),
	CONSTRAINT "fuel_equipment_types_meter_valid" CHECK ("fuel_equipment_types"."default_meter_type" IN ('odometer', 'hour_meter', 'none')),
	CONSTRAINT "fuel_equipment_types_performance_unit_valid" CHECK ("fuel_equipment_types"."default_performance_unit" IN ('km_per_liter', 'liters_per_hour', 'not_applicable'))
);
--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "equipment_type_id" text;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "meter_type" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "performance_unit" text DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "tank_capacity_liters" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "comparison_group" text;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "usual_fuel_supplier_id" text;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD COLUMN "operating_schedule" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_equipment_types_slug_unique" ON "fuel_equipment_types" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "fuel_equipment_types_category_idx" ON "fuel_equipment_types" USING btree ("category");--> statement-breakpoint
CREATE INDEX "fuel_equipment_types_active_sort_idx" ON "fuel_equipment_types" USING btree ("is_active","sort_order");--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD CONSTRAINT "fuel_vehicles_equipment_type_id_fuel_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."fuel_equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD CONSTRAINT "fuel_vehicles_usual_fuel_supplier_id_fuel_suppliers_id_fk" FOREIGN KEY ("usual_fuel_supplier_id") REFERENCES "public"."fuel_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_vehicles_equipment_type_idx" ON "fuel_vehicles" USING btree ("equipment_type_id");--> statement-breakpoint
CREATE INDEX "fuel_vehicles_performance_unit_idx" ON "fuel_vehicles" USING btree ("performance_unit");--> statement-breakpoint
CREATE INDEX "fuel_vehicles_usual_supplier_idx" ON "fuel_vehicles" USING btree ("usual_fuel_supplier_id");--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD CONSTRAINT "fuel_vehicles_meter_type_valid" CHECK ("fuel_vehicles"."meter_type" IN ('odometer', 'hour_meter', 'none'));--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD CONSTRAINT "fuel_vehicles_performance_unit_valid" CHECK ("fuel_vehicles"."performance_unit" IN ('km_per_liter', 'liters_per_hour', 'not_applicable'));--> statement-breakpoint
ALTER TABLE "fuel_vehicles" ADD CONSTRAINT "fuel_vehicles_tank_capacity_positive" CHECK ("fuel_vehicles"."tank_capacity_liters" IS NULL OR "fuel_vehicles"."tank_capacity_liters" > 0);
--> statement-breakpoint
INSERT INTO "fuel_equipment_types" ("id", "slug", "name", "category", "default_meter_type", "default_performance_unit", "sort_order") VALUES
  ('fet-camion', 'camion', 'Camión', 'truck', 'odometer', 'km_per_liter', 10),
  ('fet-tracto', 'tracto', 'Tractocamión', 'truck', 'odometer', 'km_per_liter', 20),
  ('fet-camion-3-4', 'camion_3_4', 'Camión 3/4', 'truck', 'odometer', 'km_per_liter', 30),
  ('fet-camioneta', 'camioneta', 'Camioneta', 'light', 'odometer', 'km_per_liter', 40),
  ('fet-station-wagon', 'station_wagon', 'Station wagon', 'light', 'odometer', 'km_per_liter', 50),
  ('fet-cargador', 'cargador', 'Cargador', 'heavy', 'hour_meter', 'liters_per_hour', 60),
  ('fet-tractor', 'tractor', 'Tractor', 'heavy', 'hour_meter', 'liters_per_hour', 70),
  ('fet-excavadora', 'excavadora', 'Excavadora', 'heavy', 'hour_meter', 'liters_per_hour', 80),
  ('fet-bulldozer', 'bulldozer', 'Bulldozer', 'heavy', 'hour_meter', 'liters_per_hour', 90),
  ('fet-minicargador', 'minicargador', 'Minicargador', 'heavy', 'hour_meter', 'liters_per_hour', 100),
  ('fet-retroexcavadora', 'retroexcavadora', 'Retroexcavadora', 'heavy', 'hour_meter', 'liters_per_hour', 110),
  ('fet-estanque', 'estanque', 'Estanque', 'storage', 'none', 'not_applicable', 120),
  ('fet-hidrolavadora', 'hidrolavadora', 'Hidrolavadora', 'support', 'none', 'not_applicable', 130)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "fuel_equipment_types" ("id", "slug", "name", "category", "default_meter_type", "default_performance_unit", "description", "sort_order")
SELECT DISTINCT
  'fet-legacy-' || substr(md5(lower(btrim(v."type"))), 1, 16),
  'legacy-' || substr(md5(lower(btrim(v."type"))), 1, 16),
  btrim(v."type"),
  'other',
  'none',
  'not_applicable',
  'Tipo heredado creado automáticamente durante la normalización. Requiere revisión administrativa.',
  1000
FROM "fuel_vehicles" v
WHERE CASE lower(regexp_replace(btrim(v."type"), '\s+', ' ', 'g'))
  WHEN 'camion' THEN 'camion'
  WHEN 'camión' THEN 'camion'
  WHEN 'camioneta' THEN 'camioneta'
  WHEN 'estanque' THEN 'estanque'
  WHEN 'cargador' THEN 'cargador'
  WHEN 'tractor' THEN 'tractor'
  WHEN 'excavadora' THEN 'excavadora'
  WHEN 'bulldozer' THEN 'bulldozer'
  WHEN 'minicargador' THEN 'minicargador'
  WHEN 'mini cargador' THEN 'minicargador'
  WHEN 'retroexcavadora' THEN 'retroexcavadora'
  WHEN 'retro excavadora' THEN 'retroexcavadora'
  WHEN 'hidrolavadora' THEN 'hidrolavadora'
  WHEN 'hidro lavadora' THEN 'hidrolavadora'
  WHEN 'tracto' THEN 'tracto'
  WHEN 'tractocamion' THEN 'tracto'
  WHEN 'tractocamión' THEN 'tracto'
  WHEN 'station wagon' THEN 'station_wagon'
  WHEN 'station_wagon' THEN 'station_wagon'
  WHEN 'camion 3/4' THEN 'camion_3_4'
  WHEN 'camión 3/4' THEN 'camion_3_4'
  WHEN 'camion_3_4' THEN 'camion_3_4'
  ELSE NULL
END IS NULL
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
UPDATE "fuel_vehicles" v
SET "equipment_type_id" = COALESCE(
  CASE lower(regexp_replace(btrim(v."type"), '\s+', ' ', 'g'))
    WHEN 'camion' THEN 'fet-camion'
    WHEN 'camión' THEN 'fet-camion'
    WHEN 'camioneta' THEN 'fet-camioneta'
    WHEN 'estanque' THEN 'fet-estanque'
    WHEN 'cargador' THEN 'fet-cargador'
    WHEN 'tractor' THEN 'fet-tractor'
    WHEN 'excavadora' THEN 'fet-excavadora'
    WHEN 'bulldozer' THEN 'fet-bulldozer'
    WHEN 'minicargador' THEN 'fet-minicargador'
    WHEN 'mini cargador' THEN 'fet-minicargador'
    WHEN 'retroexcavadora' THEN 'fet-retroexcavadora'
    WHEN 'retro excavadora' THEN 'fet-retroexcavadora'
    WHEN 'hidrolavadora' THEN 'fet-hidrolavadora'
    WHEN 'hidro lavadora' THEN 'fet-hidrolavadora'
    WHEN 'tracto' THEN 'fet-tracto'
    WHEN 'tractocamion' THEN 'fet-tracto'
    WHEN 'tractocamión' THEN 'fet-tracto'
    WHEN 'station wagon' THEN 'fet-station-wagon'
    WHEN 'station_wagon' THEN 'fet-station-wagon'
    WHEN 'camion 3/4' THEN 'fet-camion-3-4'
    WHEN 'camión 3/4' THEN 'fet-camion-3-4'
    WHEN 'camion_3_4' THEN 'fet-camion-3-4'
    ELSE NULL
  END,
  'fet-legacy-' || substr(md5(lower(btrim(v."type"))), 1, 16)
);
--> statement-breakpoint
UPDATE "fuel_vehicles" v
SET
  "meter_type" = t."default_meter_type",
  "performance_unit" = t."default_performance_unit"
FROM "fuel_equipment_types" t
WHERE t."id" = v."equipment_type_id";

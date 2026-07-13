ALTER TABLE "fuel_equipment_types" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO "fuel_equipment_types" ("id", "slug", "name", "category", "default_meter_type", "default_performance_unit", "description", "sort_order", "is_system")
VALUES ('fet-other', 'other', 'Otro tipo', 'other', 'none', 'not_applicable', 'Tipo de respaldo para integraciones heredadas; debe reclasificarse desde el catálogo.', 999, true)
ON CONFLICT ("slug") DO UPDATE SET "is_system" = true;
--> statement-breakpoint
UPDATE "fuel_equipment_types"
SET "is_system" = true
WHERE "id" IN ('fet-camion', 'fet-tracto', 'fet-camion-3-4', 'fet-camioneta', 'fet-station-wagon', 'fet-cargador', 'fet-tractor', 'fet-excavadora', 'fet-bulldozer', 'fet-minicargador', 'fet-retroexcavadora', 'fet-estanque', 'fet-hidrolavadora');

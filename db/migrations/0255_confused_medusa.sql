ALTER TABLE "prevention_emergency_drills" DROP CONSTRAINT "prevention_emergency_drill_scenario_type_valid";--> statement-breakpoint
ALTER TABLE "prevention_emergency_scenarios" DROP CONSTRAINT "prevention_emergency_scenario_type_valid";--> statement-breakpoint
-- Mapeo de los tres valores retirados. Al escribir esta migración las dos
-- tablas estaban vacías en producción, así que en principio no afecta a nadie;
-- va igual porque cuesta seis líneas y evita depender de un hecho que envejece.
--   incendio -> incendio_estructural  (el protocolo lo parte en estructural y forestal)
--   clima    -> otra_amenaza          (lo cubren nevada, marejada e inundación)
--   otro     -> otra_amenaza          (mismo significado, nombre más honesto)
UPDATE "prevention_emergency_scenarios" SET "type" = 'incendio_estructural' WHERE "type" = 'incendio';--> statement-breakpoint
UPDATE "prevention_emergency_scenarios" SET "type" = 'otra_amenaza' WHERE "type" IN ('clima', 'otro');--> statement-breakpoint
UPDATE "prevention_emergency_drills" SET "scenario_type" = 'incendio_estructural' WHERE "scenario_type" = 'incendio';--> statement-breakpoint
UPDATE "prevention_emergency_drills" SET "scenario_type" = 'otra_amenaza' WHERE "scenario_type" IN ('clima', 'otro');--> statement-breakpoint
ALTER TABLE "prevention_emergency_drills" ADD CONSTRAINT "prevention_emergency_drill_scenario_type_valid" CHECK ("prevention_emergency_drills"."scenario_type" IN ('sismo', 'tsunami', 'aluvion', 'incendio_estructural', 'incendio_forestal', 'asalto_robo', 'erupcion_volcanica', 'inundacion_lluvia', 'inundacion_cauce', 'nevada', 'marejada', 'corte_energia', 'corte_agua', 'desorden_publico', 'otra_amenaza', 'derrame', 'fuga', 'volcamiento', 'exposicion', 'rescate'));--> statement-breakpoint
ALTER TABLE "prevention_emergency_scenarios" ADD CONSTRAINT "prevention_emergency_scenario_type_valid" CHECK ("prevention_emergency_scenarios"."type" IN ('sismo', 'tsunami', 'aluvion', 'incendio_estructural', 'incendio_forestal', 'asalto_robo', 'erupcion_volcanica', 'inundacion_lluvia', 'inundacion_cauce', 'nevada', 'marejada', 'corte_energia', 'corte_agua', 'desorden_publico', 'otra_amenaza', 'derrame', 'fuga', 'volcamiento', 'exposicion', 'rescate'));
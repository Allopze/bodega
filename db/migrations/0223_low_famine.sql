ALTER TABLE "fuel_anomaly_cases" ADD COLUMN "resolution_kind" text;--> statement-breakpoint
ALTER TABLE "fuel_anomaly_cases" ADD CONSTRAINT "fuel_anomaly_cases_resolution_kind_valid" CHECK ("fuel_anomaly_cases"."resolution_kind" IS NULL OR "fuel_anomaly_cases"."resolution_kind" IN ('lectura_corregida', 'reset_medidor'));--> statement-breakpoint
-- Los casos de medidor YA cerrados se marcan como reset real: es la semántica
-- que Flota y Mantenciones les venían dando, y dejarlos en NULL cambiaría de
-- golpe el recorrido calculado de todo equipo con un caso resuelto. Los casos
-- nuevos exigen la elección explícita del revisor.
UPDATE "fuel_anomaly_cases"
SET "resolution_kind" = 'reset_medidor'
WHERE "rule_code" IN ('kilometraje_regresivo', 'horometro_regresivo')
  AND "status" IN ('resolved', 'dismissed')
  AND "resolution_kind" IS NULL;

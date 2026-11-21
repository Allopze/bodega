-- Reversión compensatoria de 0398_furry_luckman (Trinorma, 2026-11-21).
--
-- El repositorio sólo migra hacia adelante (AGENTS.md: nunca tocar el journal).
-- Si hubiera que deshacer la 0398, este SQL se copia a una migración NUEVA,
-- generada como `--custom`, y se registra su checksum. No se ejecuta a mano.
--
-- OJO: descarta lo que se haya cargado en las estructuras nuevas (alias de
-- faena, propietarios, historial de inspecciones y pautas, metadatos del
-- consolidado, campos nuevos de la OT). Respaldar antes. No toca nada que
-- existiera antes de la 0398.
--
-- Lo prueba `db/__tests__/trinorma-0398-pglite.test.ts`: aplicar → revertir deja
-- el mismo catálogo que la cadena hasta la 0397.

DROP INDEX IF EXISTS "fuel_vehicles_code_key_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "fuel_vehicles_owner_idx";--> statement-breakpoint
ALTER TABLE "fuel_vehicles" DROP CONSTRAINT IF EXISTS "fuel_vehicles_owner_id_fleet_owners_id_fk";--> statement-breakpoint
ALTER TABLE "fuel_vehicles" DROP COLUMN IF EXISTS "owner_id";--> statement-breakpoint
ALTER TABLE "fuel_vehicles" DROP COLUMN IF EXISTS "location_pending_confirmation";--> statement-breakpoint
DROP TABLE IF EXISTS "fleet_owners";--> statement-breakpoint
DROP TABLE IF EXISTS "worksite_aliases";--> statement-breakpoint
ALTER TABLE "worksites" DROP CONSTRAINT IF EXISTS "worksites_kind_valid";--> statement-breakpoint
ALTER TABLE "worksites" DROP COLUMN IF EXISTS "kind";--> statement-breakpoint
DROP INDEX IF EXISTS "mant_work_orders_action_type_idx";--> statement-breakpoint
ALTER TABLE "mant_work_orders" DROP CONSTRAINT IF EXISTS "mant_work_orders_action_type_valid";--> statement-breakpoint
ALTER TABLE "mant_work_orders" DROP CONSTRAINT IF EXISTS "mant_work_orders_specialties_valid";--> statement-breakpoint
ALTER TABLE "mant_work_orders" DROP CONSTRAINT IF EXISTS "mant_work_orders_labor_hours_valid";--> statement-breakpoint
ALTER TABLE "mant_work_orders" DROP CONSTRAINT IF EXISTS "mant_work_orders_execution_worksite_id_worksites_id_fk";--> statement-breakpoint
ALTER TABLE "mant_work_orders" DROP COLUMN IF EXISTS "action_type";--> statement-breakpoint
ALTER TABLE "mant_work_orders" DROP COLUMN IF EXISTS "specialties";--> statement-breakpoint
ALTER TABLE "mant_work_orders" DROP COLUMN IF EXISTS "labor_hours";--> statement-breakpoint
ALTER TABLE "mant_work_orders" DROP COLUMN IF EXISTS "execution_worksite_id";--> statement-breakpoint
ALTER TABLE "mant_work_orders" DROP COLUMN IF EXISTS "work_performed";--> statement-breakpoint
DROP INDEX IF EXISTS "mant_historical_records_source_record_idx";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP CONSTRAINT IF EXISTS "mant_historical_records_action_type_valid";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP CONSTRAINT IF EXISTS "mant_historical_records_specialties_valid";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP CONSTRAINT IF EXISTS "mant_historical_records_numbers_valid";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP COLUMN IF EXISTS "source_record_id";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP COLUMN IF EXISTS "origin_source";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP COLUMN IF EXISTS "action_type";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP COLUMN IF EXISTS "labor_hours";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP COLUMN IF EXISTS "downtime_days";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP COLUMN IF EXISTS "specialties";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP COLUMN IF EXISTS "contract_text";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP COLUMN IF EXISTS "quality_notes";--> statement-breakpoint
ALTER TABLE "mant_historical_records" DROP COLUMN IF EXISTS "is_test";--> statement-breakpoint
DROP TABLE IF EXISTS "mant_historical_findings";--> statement-breakpoint
DROP TABLE IF EXISTS "mant_historical_inspections";--> statement-breakpoint
DROP TABLE IF EXISTS "mant_historical_schedule_checks";

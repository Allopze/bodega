-- Reversión compensatoria de 0399_fixed_dreadnoughts (Trinorma, preventiva declarada, 2026-11-21).
--
-- El repositorio sólo migra hacia adelante (AGENTS.md: nunca tocar el journal).
-- Si hubiera que deshacer la 0399, este SQL se copia a una migración NUEVA,
-- generada como `--custom`, y se registra su checksum. No se ejecuta a mano.
--
-- OJO: descarta las preventivas declaradas anteriores a la plataforma (fecha,
-- lectura, servicio, respaldo, quién la declaró y la fuente). La bitácora y el
-- historial del equipo las conservan. Respaldar antes. No toca nada que
-- existiera antes de la 0399.
--
-- Lo prueba `db/__tests__/trinorma-0399-pglite.test.ts`: aplicar → revertir deja
-- el mismo catálogo que la cadena hasta la 0398.
ALTER TABLE "mant_equipment_profiles" DROP CONSTRAINT IF EXISTS "mant_equipment_profiles_prior_preventive_valid";
--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" DROP CONSTRAINT IF EXISTS "mant_equipment_profiles_prior_preventive_all";
--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" DROP CONSTRAINT IF EXISTS "mant_equipment_profiles_prior_declared_by_fk";
--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" DROP COLUMN IF EXISTS "prior_preventive_source";
--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" DROP COLUMN IF EXISTS "prior_preventive_declared_by";
--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" DROP COLUMN IF EXISTS "prior_preventive_evidence";
--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" DROP COLUMN IF EXISTS "prior_preventive_interval";
--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" DROP COLUMN IF EXISTS "prior_preventive_reading";
--> statement-breakpoint
ALTER TABLE "mant_equipment_profiles" DROP COLUMN IF EXISTS "prior_preventive_date";

-- Tercer estado del checklist de capacitación: "no aplica" (2026-09-19).
--
-- Una faena donde una actividad del programa no corresponde no tenía cómo
-- decirlo: la ocurrencia quedaba `pending` para siempre y el barrido de
-- obligaciones la contaba como incumplimiento.
--
-- El trío de columnas es simétrico al de `completed`, y el CHECK lleva rama
-- negativa: sin ella, corregir un "no aplica" a "hecha" deja el motivo colgado
-- y el Excel que se le entrega a un fiscalizador muestra un motivo de
-- no-aplicabilidad junto a una capacitación realizada.
--
-- El piso del motivo es 10 caracteres, el mismo que ya exige
-- `excludeActivityForWorksite` para sacar una actividad del denominador.
ALTER TABLE "prevention_training_occurrences" ADD COLUMN IF NOT EXISTS "not_applicable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prevention_training_occurrences" ADD COLUMN IF NOT EXISTS "not_applicable_by_user_id" text;--> statement-breakpoint
ALTER TABLE "prevention_training_occurrences" ADD COLUMN IF NOT EXISTS "not_applicable_reason" text;--> statement-breakpoint
-- `ADD CONSTRAINT` no admite `IF NOT EXISTS` en Postgres: el `DROP ... IF EXISTS`
-- previo es lo que hace la migración re-aplicable.
ALTER TABLE "prevention_training_occurrences" DROP CONSTRAINT IF EXISTS "training_occurrence_na_actor_fk";--> statement-breakpoint
ALTER TABLE "prevention_training_occurrences" ADD CONSTRAINT "training_occurrence_na_actor_fk" FOREIGN KEY ("not_applicable_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_training_occurrences" DROP CONSTRAINT IF EXISTS "prevention_training_occurrence_na_consistency_check";--> statement-breakpoint
ALTER TABLE "prevention_training_occurrences" ADD CONSTRAINT "prevention_training_occurrence_na_consistency_check" CHECK (("prevention_training_occurrences"."status" = 'not_applicable' AND "prevention_training_occurrences"."not_applicable_at" IS NOT NULL AND "prevention_training_occurrences"."not_applicable_by_user_id" IS NOT NULL AND length(trim(COALESCE("prevention_training_occurrences"."not_applicable_reason", ''))) >= 10) OR ("prevention_training_occurrences"."status" <> 'not_applicable' AND "prevention_training_occurrences"."not_applicable_at" IS NULL AND "prevention_training_occurrences"."not_applicable_by_user_id" IS NULL AND "prevention_training_occurrences"."not_applicable_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "prevention_training_occurrences" DROP CONSTRAINT IF EXISTS "prevention_training_occurrence_status_check";--> statement-breakpoint
ALTER TABLE "prevention_training_occurrences" ADD CONSTRAINT "prevention_training_occurrence_status_check" CHECK ("prevention_training_occurrences"."status" IN ('pending', 'completed', 'not_completed', 'not_applicable'));

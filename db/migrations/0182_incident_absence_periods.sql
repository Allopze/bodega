-- NORM-07 (auditoría 2026-08-17): los dias perdidos se atribuian integros al
-- mes de OCURRENCIA del accidente. Un accidente del 25 de junio con 45 dias de
-- reposo cargaba los 45 al primer semestre y dejaba el segundo en cero, lo que
-- distorsiona la tasa de gravedad, que el DS 44 calcula por semestre.
--
-- Escrita a mano (no `drizzle-kit generate`) por el checkout compartido.

CREATE TABLE IF NOT EXISTS "prevention_incident_absence_periods" (
  "id" text PRIMARY KEY NOT NULL,
  "person_id" text NOT NULL,
  "start_date" text NOT NULL,
  "end_date" text,
  "note" text,
  "created_by_user_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint

ALTER TABLE "prevention_incident_absence_periods"
  ADD CONSTRAINT "prevention_incident_absence_periods_person_id_prevention_incident_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "public"."prevention_incident_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "prevention_incident_absence_periods"
  ADD CONSTRAINT "prevention_incident_absence_periods_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prevention_incident_absence_period_person_idx"
  ON "prevention_incident_absence_periods" USING btree ("person_id","start_date");--> statement-breakpoint

ALTER TABLE "prevention_incident_absence_periods"
  ADD CONSTRAINT "prevention_incident_absence_period_range_valid"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");--> statement-breakpoint

-- Los registros existentes sólo tienen el total: se marcan como heredados en
-- vez de inventarles fechas. Conservan el algoritmo histórico y quedan
-- explícitamente identificados como sin distribución temporal verificable.
ALTER TABLE "prevention_incident_people"
  ADD COLUMN IF NOT EXISTS "absence_allocation" text DEFAULT 'legacy_unallocated' NOT NULL;--> statement-breakpoint

ALTER TABLE "prevention_incident_people"
  ADD CONSTRAINT "prevention_incident_person_absence_allocation_valid"
  CHECK ("absence_allocation" IN ('periods', 'legacy_unallocated'));

ALTER TABLE "prevention_emergency_resources" DROP CONSTRAINT "prevention_emergency_resources_plan_id_prevention_emergency_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ALTER COLUMN "plan_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ADD COLUMN "serial_number" text;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ADD COLUMN "expires_at" text;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ADD CONSTRAINT "prevention_emergency_resources_plan_id_prevention_emergency_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."prevention_emergency_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_due_idx" ON "prevention_emergency_resources" USING btree ("next_inspection_at");--> statement-breakpoint
CREATE INDEX "prevention_emergency_resource_expiry_idx" ON "prevention_emergency_resources" USING btree ("expires_at");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- `worksite_id` en tres pasos, no en uno.
--
-- drizzle-kit genera `ADD COLUMN "worksite_id" text NOT NULL`, que en Postgres
-- falla contra una tabla con filas: no hay default del que tomar el valor. El
-- equipo ya tenía dueño —el plan al que colgaba— así que se agrega la columna
-- nullable, se rellena desde el plan y recién entonces se exige NOT NULL.
--
-- Idempotente: `IF NOT EXISTS` y `WHERE worksite_id IS NULL` permiten reintentar
-- la migración si se corta a la mitad.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "prevention_emergency_resources" ADD COLUMN IF NOT EXISTS "worksite_id" text;--> statement-breakpoint
UPDATE "prevention_emergency_resources" r
   SET "worksite_id" = p."worksite_id"
  FROM "prevention_emergency_plans" p
 WHERE p."id" = r."plan_id"
   AND r."worksite_id" IS NULL;--> statement-breakpoint
ALTER TABLE "prevention_emergency_resources" ALTER COLUMN "worksite_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "prevention_emergency_resources"
    ADD CONSTRAINT "prevention_emergency_resources_worksite_id_worksites_id_fk"
    FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prevention_emergency_resource_worksite_idx" ON "prevention_emergency_resources" USING btree ("worksite_id");

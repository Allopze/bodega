ALTER TABLE "fuel_tae_submissions" DROP CONSTRAINT IF EXISTS "fuel_tae_submissions_loaded_at_source_valid";--> statement-breakpoint
DROP INDEX IF EXISTS "fuel_review_marks_unique_mark";--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD COLUMN "backdate_reason" text;--> statement-breakpoint
ALTER TABLE "fuel_review_marks" ADD COLUMN "worksite_id" text;--> statement-breakpoint
ALTER TABLE "fuel_review_marks" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "fuel_review_marks" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "fuel_review_marks" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fuel_review_marks" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "fuel_review_marks" ADD CONSTRAINT "fuel_review_marks_worksite_id_worksites_id_fk" FOREIGN KEY ("worksite_id") REFERENCES "public"."worksites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_review_marks" ADD CONSTRAINT "fuel_review_marks_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_review_marks_status_worksite_idx" ON "fuel_review_marks" USING btree ("status","worksite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_review_marks_unique_open" ON "fuel_review_marks" USING btree ("entity_type","entity_id") WHERE "fuel_review_marks"."status" = 'open';--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_backdate_reason_valid" CHECK (("fuel_tae_submissions"."loaded_at_source" = 'backdated') = ("fuel_tae_submissions"."backdate_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "fuel_tae_submissions" ADD CONSTRAINT "fuel_tae_submissions_loaded_at_source_valid" CHECK ("fuel_tae_submissions"."loaded_at_source" IN ('server', 'device', 'device_offline', 'import', 'backdated'));--> statement-breakpoint
ALTER TABLE "fuel_review_marks" ADD CONSTRAINT "fuel_review_marks_status_valid" CHECK ("fuel_review_marks"."status" IN ('open', 'resolved', 'withdrawn'));--> statement-breakpoint
-- Rediseño de Combustible (2026-10-31), datos no RBAC, idempotentes.
-- 1) Faena de los pedidos de revisión que ya existían, desde la carga a la que apuntan.
UPDATE "fuel_review_marks" AS m SET "worksite_id" = s."worksite_id"
FROM "fuel_tae_submissions" AS s
WHERE m."worksite_id" IS NULL AND m."entity_type" = 'fuel_tae_submission' AND m."entity_id" = s."id";--> statement-breakpoint
UPDATE "fuel_review_marks" AS m SET "worksite_id" = l."worksite_id"
FROM "fuel_loads" AS l
WHERE m."worksite_id" IS NULL AND m."entity_type" = 'fuel_load' AND m."entity_id" = l."id";--> statement-breakpoint
UPDATE "fuel_review_marks" AS m SET "worksite_id" = o."worksite_id"
FROM "fuel_operation_records" AS o
WHERE m."worksite_id" IS NULL AND m."entity_type" = 'fuel_operation_record' AND m."entity_id" = o."id";--> statement-breakpoint
-- 2) Interruptores de submódulo: la clave es el href del ítem del menú, y los ítems
-- cambiaron de href. Una clave vieja queda ignorada en silencio (el submódulo se
-- vuelve a encender), así que se copia a la clave nueva y se borra. «/combustibles»
-- era «Consumo» y ahora es el Panel: su fila va a «/combustibles/consumo» y se
-- borra, para que el Panel no herede un apagado. «/combustibles/tae» no se copia
-- a Cargas: apagaría toda la lista de cargas.
INSERT INTO "system_settings" ("key", "value", "updated_at")
SELECT 'submodule.enabled:combustibles:/combustibles/consumo', "value", now() FROM "system_settings"
WHERE "key" = 'submodule.enabled:combustibles:/combustibles'
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
DELETE FROM "system_settings" WHERE "key" = 'submodule.enabled:combustibles:/combustibles';--> statement-breakpoint
INSERT INTO "system_settings" ("key", "value", "updated_at")
SELECT 'submodule.enabled:combustibles:/combustibles/cargas', "value", now() FROM "system_settings"
WHERE "key" = 'submodule.enabled:combustibles:/combustibles/bitacora'
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "system_settings" ("key", "value", "updated_at")
SELECT 'submodule.enabled:combustibles:/combustibles/fuentes', "value", now() FROM "system_settings"
WHERE "key" = 'submodule.enabled:combustibles:/combustibles/bitacora'
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
DELETE FROM "system_settings" WHERE "key" = 'submodule.enabled:combustibles:/combustibles/bitacora';--> statement-breakpoint
INSERT INTO "system_settings" ("key", "value", "updated_at")
SELECT 'submodule.enabled:combustibles:/combustibles/revisar', "value", now() FROM "system_settings"
WHERE "key" = 'submodule.enabled:combustibles:/combustibles/revision'
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
DELETE FROM "system_settings" WHERE "key" = 'submodule.enabled:combustibles:/combustibles/revision';--> statement-breakpoint
INSERT INTO "system_settings" ("key", "value", "updated_at")
SELECT 'submodule.enabled:combustibles:/combustibles/cuadratura', "value", now() FROM "system_settings"
WHERE "key" = 'submodule.enabled:combustibles:/combustibles/tae'
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
DELETE FROM "system_settings" WHERE "key" = 'submodule.enabled:combustibles:/combustibles/tae';--> statement-breakpoint
INSERT INTO "system_settings" ("key", "value", "updated_at")
SELECT 'submodule.enabled:combustibles:/combustibles/pagos', "value", now() FROM "system_settings"
WHERE "key" = 'submodule.enabled:combustibles:/combustibles/facturas'
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
DELETE FROM "system_settings" WHERE "key" = 'submodule.enabled:combustibles:/combustibles/facturas';

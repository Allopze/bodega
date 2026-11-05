-- Mantención de equipos (auditoría 2026-11-04, hallazgo 3.5 y plan de
-- corrección E2): la base garantiza la composición de fotos de un registro y
-- completa los índices de FK que faltaban.
--
-- Aditiva: no modifica ni borra datos. Los dos índices únicos son PARCIALES
-- sobre `record_id` no nulo, así que no tocan las fotos huérfanas (se suben
-- antes que el registro). El pre-check de arriba aborta con un mensaje legible
-- si la base ya trae filas que los índices no podrían aceptar: preferimos eso
-- a un error de constraint a mitad de la migración.
--
-- Los índices `mant_schedule_brand_rules_brand_id_idx` y
-- `mant_work_orders_requested_by_user_id_idx` no se declaran en
-- `db/schema/*.ts` en esta migración porque esos archivos pertenecen a otro
-- carril del plan de corrección; van como SQL custom idempotente al final.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM mant_record_photos WHERE record_id IS NOT NULL AND kind IN ('filtros','sticker') GROUP BY record_id, kind HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Hay fotos filtros/sticker duplicadas por registro: límpialas antes de aplicar la migración';
  END IF;
  IF EXISTS (SELECT 1 FROM mant_record_photos WHERE record_id IS NOT NULL GROUP BY record_id, sort_order HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Hay fotos con el mismo sort_order en un registro: límpialas antes de aplicar la migración';
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX "mant_record_drivers_driver_id_idx" ON "mant_record_drivers" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "mant_record_jobs_work_type_id_idx" ON "mant_record_jobs" USING btree ("work_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mant_record_photos_preventive_unique" ON "mant_record_photos" USING btree ("record_id","kind") WHERE "mant_record_photos"."record_id" is not null and "mant_record_photos"."kind" in ('filtros','sticker');--> statement-breakpoint
CREATE UNIQUE INDEX "mant_record_photos_record_order_unique" ON "mant_record_photos" USING btree ("record_id","sort_order") WHERE "mant_record_photos"."record_id" is not null;--> statement-breakpoint
CREATE INDEX "mant_records_duplicate_of_record_id_idx" ON "mant_records" USING btree ("duplicate_of_record_id");--> statement-breakpoint
CREATE INDEX "mant_records_corrects_record_id_idx" ON "mant_records" USING btree ("corrects_record_id");--> statement-breakpoint
CREATE INDEX "mant_records_executor_workshop_id_idx" ON "mant_records" USING btree ("executor_workshop_id");--> statement-breakpoint
ALTER TABLE "mant_record_photos" ADD CONSTRAINT "mant_record_photos_sort_order_valid" CHECK ("mant_record_photos"."sort_order" >= 0);--> statement-breakpoint
-- SQL custom (E2): índices de FK que el generador no emite porque las tablas
-- viven en archivos de esquema que no se tocan en esta migración. Idempotentes.
CREATE INDEX IF NOT EXISTS "mant_schedule_brand_rules_brand_id_idx" ON "mant_schedule_brand_rules" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mant_work_orders_requested_by_user_id_idx" ON "mant_work_orders" USING btree ("requested_by_user_id");

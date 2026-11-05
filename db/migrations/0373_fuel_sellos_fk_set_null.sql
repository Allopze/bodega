-- E4 / D2 (auditoría 2026-11-05, 2.4): `fuel_seal_movements.submission_id` pasa a
-- `ON DELETE SET NULL`. El movimiento de sello es historial: la reversa de un lote
-- TAE lo BORRABA para poder borrar la carga, y con la fila se iba `evidence_sha256`,
-- el único registro del hash de la foto del sello. Con `SET NULL` el movimiento
-- sobrevive, queda con `submission_id NULL` y la reversa lo marca con
-- `reverted_at` / `reverted_by` / `reverted_reason` (columnas de la 0372).
--
-- Este ALTER va en una migración custom a propósito: 0053_icy_nova creó la FK con
-- `ON DELETE NO ACTION`, mientras el snapshot de Drizzle ya la declaraba `cascade`.
-- Es decir, el drift es entre la BASE y el snapshot/schema, no dentro del schema, y
-- por eso no puede depender de lo que la comparación de esquema detecte al generar.
-- El `DROP` lleva `IF EXISTS` para que la migración sea reaplicable en una base que
-- ya tenga la definición correcta (por ejemplo, creada con `db:push`).
ALTER TABLE "fuel_seal_movements" DROP CONSTRAINT IF EXISTS "fuel_seal_movements_submission_id_fuel_tae_submissions_id_fk";--> statement-breakpoint
ALTER TABLE "fuel_seal_movements" ADD CONSTRAINT "fuel_seal_movements_submission_id_fuel_tae_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."fuel_tae_submissions"("id") ON DELETE set null ON UPDATE no action;

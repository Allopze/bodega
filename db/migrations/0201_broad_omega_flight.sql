-- Revalidar una carga TAE (validada → observada → validada) volvía a insertar el
-- movimiento de sello retirado: el historial mostraba dos retiros del mismo sello
-- en el mismo acto. Se concilia el histórico antes de exigir la unicidad,
-- conservando el movimiento más antiguo de cada (envío, tipo, sello) —el que
-- corresponde a la validación original— y su evidencia.
DELETE FROM "fuel_seal_movements" AS duplicated
USING (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "submission_id", "movement_type", "seal_number"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS duplicate_rank
  FROM "fuel_seal_movements"
) AS ranked
WHERE ranked."id" = duplicated."id"
  AND ranked.duplicate_rank > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_seal_movements_submission_type_seal_unique" ON "fuel_seal_movements" USING btree ("submission_id","movement_type","seal_number");

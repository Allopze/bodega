-- La faena de una mantención es la del equipo. Antes era opcional y editable:
-- las filas sin faena quedaban fuera de todo listado acotado y aun así se
-- podían cancelar por ID, y las imputadas a otra faena partían el mismo gasto
-- entre dos agregados (/flota agrega por la faena del registro, el listado
-- también). Se realinea el histórico con el vehículo antes de exigir NOT NULL.
UPDATE "maintenance_records" AS maintenance
SET "worksite_id" = vehicle."worksite_id"
FROM "fuel_vehicles" AS vehicle
WHERE vehicle."id" = maintenance."vehicle_id"
  AND ("maintenance"."worksite_id" IS NULL OR "maintenance"."worksite_id" <> vehicle."worksite_id");--> statement-breakpoint
ALTER TABLE "maintenance_records" ALTER COLUMN "worksite_id" SET NOT NULL;

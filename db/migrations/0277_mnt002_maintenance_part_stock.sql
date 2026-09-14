-- MNT-002 (auditoría 2026-09-14): los repuestos consumidos en una orden de
-- trabajo no descontaban stock. La línea era texto libre sin referencia al
-- catálogo, y ningún tipo de movimiento del kardex correspondía a una
-- mantención: un repuesto comprado por Solicitudes → OC → Recepción **sumaba**
-- existencias en la faena y su consumo no las restaba nunca.
--
-- Dos cambios mínimos: la línea puede apuntar a un producto del catálogo
-- (nullable, porque un taller externo factura piezas que nunca pasaron por
-- bodega) y el kardex admite el egreso que cierra el circuito.
ALTER TABLE "maintenance_parts"
  ADD COLUMN IF NOT EXISTS "product_id" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_parts_product_id_products_id_fk'
  ) THEN
    ALTER TABLE "maintenance_parts"
      ADD CONSTRAINT "maintenance_parts_product_id_products_id_fk"
      FOREIGN KEY ("product_id") REFERENCES "products"("id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "maintenance_parts_product_idx" ON "maintenance_parts" ("product_id");

ALTER TABLE "inventory_movements"
  DROP CONSTRAINT IF EXISTS "inventory_movements_type_valid";

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_type_valid" CHECK (
    "type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho', 'retiro_epp_trabajador', 'ajuste', 'egreso_traslado', 'ingreso_traslado', 'ingreso_anulacion', 'egreso_anulacion', 'egreso_mantencion')
  );

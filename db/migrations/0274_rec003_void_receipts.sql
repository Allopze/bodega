-- REC-003 (auditoría 2026-09-14), patrón P5: una recepción equivocada no tenía
-- salida. No había columnas de anulación ni un solo UPDATE sobre la tabla en
-- toda la aplicación, y el único remedio era un ajuste de inventario que
-- corrige el saldo pero no revierte el avance de la OC ni el estado del ítem.
ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "voided_by" text REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "void_reason" text;
--> statement-breakpoint
ALTER TABLE "receipts" DROP CONSTRAINT IF EXISTS "receipts_location_status_valid";
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_location_status_valid" CHECK (
  "location_type" IN ('office', 'faena') AND "status" IN ('open', 'closed', 'voided')
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_void_complete" CHECK (
  ("voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL
    AND "status" <> 'voided')
  OR ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL
    AND char_length(trim("void_reason")) >= 10
    AND "status" = 'voided')
);
--> statement-breakpoint
-- El reverso de una recepción anulada, espejo de `ingreso_anulacion`.
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_type_valid";
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_valid" CHECK (
  "type" IN ('ingreso_oc', 'egreso_entrega', 'ingreso_devolucion', 'egreso_desecho',
             'retiro_epp_trabajador', 'ajuste', 'egreso_traslado', 'ingreso_traslado',
             'ingreso_anulacion', 'egreso_anulacion')
);

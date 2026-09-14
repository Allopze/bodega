-- FAC-002 (auditoría 2026-09-14), patrón P5: quitar una factura de una OC era un
-- DELETE físico que se llevaba las líneas, las asignaciones y el archivo del
-- documento tributario. Se anula en vez de borrarse.
ALTER TABLE "purchase_order_invoices"
  ADD COLUMN IF NOT EXISTS "voided_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "voided_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "void_reason" text;
--> statement-breakpoint
ALTER TABLE "purchase_order_invoices"
  ADD CONSTRAINT "purchase_order_invoices_void_complete" CHECK (
    ("voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
    OR ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL
        AND char_length(trim("void_reason")) >= 10)
  );
--> statement-breakpoint
-- El folio es único entre las facturas VIGENTES de la OC: con la fila anulada
-- en su sitio, volver a cargar el folio correcto chocaría contra el propio
-- error que se está corrigiendo.
DROP INDEX IF EXISTS "purchase_order_invoices_order_number_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_invoices_order_number_unique"
  ON "purchase_order_invoices" ("purchase_order_id","document_kind","invoice_number")
  WHERE "voided_at" IS NULL;

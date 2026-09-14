-- FAC-001 (auditoría 2026-09-14): la unicidad del folio estaba declarada por OC
-- —(purchase_order_id, document_kind, invoice_number)—, de modo que el mismo
-- folio del mismo proveedor podía adjuntarse a DOS órdenes distintas y contarse
-- dos veces en la cobertura documental, en el gasto y en cualquier proceso de
-- pago que lea la tabla. Un documento tributario existe una sola vez: el folio
-- de un proveedor identifica una obligación de pago, no una por orden.
--
-- El índice sólo alcanza a las filas que declaran el RUT del proveedor: sin RUT
-- no hay identidad que comparar, y dos órdenes pueden tener el folio 100 de
-- proveedores distintos sin que eso sea un duplicado. El servicio aplica la
-- misma regla dentro de la transacción, con el RUT normalizado.
--
-- Si esta migración falla, la base YA tiene el duplicado que el hallazgo
-- describe. No es un error de la migración: es el dato. El bloque de abajo lo
-- nombra en vez de dejar un error de índice sin contexto; el remedio es anular
-- (FAC-002, nunca borrar) el adjunto que sobra y volver a desplegar.
DO $$
DECLARE
  duplicados text;
BEGIN
  SELECT string_agg(format('folio %s del RUT %s en %s órdenes', folio, rut, veces), '; ')
    INTO duplicados
  FROM (
    SELECT
      nullif(regexp_replace(invoice_number, '[^0-9]', '', 'g'), '')::bigint AS folio,
      upper(regexp_replace(document_supplier_rut, '[^0-9kK]', '', 'g'))     AS rut,
      count(DISTINCT purchase_order_id)                                     AS veces
    FROM purchase_order_invoices
    WHERE voided_at IS NULL
      AND document_supplier_rut IS NOT NULL
      AND nullif(regexp_replace(invoice_number, '[^0-9]', '', 'g'), '') IS NOT NULL
    GROUP BY 1, 2, document_kind
    HAVING count(DISTINCT purchase_order_id) > 1
  ) d;

  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION 'FAC-001: hay documentos de proveedor adjuntos a más de una OC (%). Anula el adjunto que sobra antes de aplicar esta migración.', duplicados;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_invoices_supplier_folio_unique"
  ON "purchase_order_invoices" (
    upper(regexp_replace("document_supplier_rut", '[^0-9kK]', '', 'g')),
    "document_kind",
    (nullif(regexp_replace("invoice_number", '[^0-9]', '', 'g'), '')::bigint)
  )
  WHERE "voided_at" IS NULL AND "document_supplier_rut" IS NOT NULL;

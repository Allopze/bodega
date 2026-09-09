import postgres from "postgres"

/**
 * Diagnóstico previo a desplegar la conciliación OC-factura.
 *
 * No depende de las columnas nuevas de proyección, por lo que puede ejecutarse
 * antes de migrar. La transacción READ ONLY convierte la promesa de este script
 * en una garantía del propio PostgreSQL.
 */
export interface PurchaseInvoiceReconciliationPreflight {
  invoicesWithoutLines: number
  unlinkedLines: number
  priceVarianceLines: number
  affectedClosedOrders: number
  ordersWithMultipleInvoices: number
  ordersWithMultipleReceipts: number
  uniqueReceiptSuggestions: number
  ambiguousReceiptSuggestions: number
}

export async function readPurchaseInvoiceReconciliationPreflight(
  sql: postgres.Sql,
): Promise<PurchaseInvoiceReconciliationPreflight> {
  try {
    return await readReport(sql, true)
  } catch (error) {
    // The deploy preflight can precede the allocation migration. Retry in a
    // fresh transaction because PostgreSQL aborts the failed one. Never hide
    // authorization, syntax, missing-column or other database errors.
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "42P01") throw error
    return readReport(sql, false)
  }
}

async function readReport(sql: postgres.Sql, useAllocations: boolean): Promise<PurchaseInvoiceReconciliationPreflight> {
  const [report] = await sql.begin("read only", async (tx) => tx<{
    invoices_without_lines: number
    unlinked_lines: number
    price_variance_lines: number
    affected_closed_orders: number
    orders_with_multiple_invoices: number
    orders_with_multiple_receipts: number
    unique_receipt_suggestions: number
    ambiguous_receipt_suggestions: number
  }[]>`
    WITH allocations AS (
      ${tx.unsafe(useAllocations
        ? "SELECT invoice_item_id, purchase_order_item_id, quantity, subtotal FROM purchase_order_invoice_item_allocations"
        : "SELECT id AS invoice_item_id, purchase_order_item_id, quantity, subtotal FROM purchase_order_invoice_items WHERE purchase_order_item_id IS NOT NULL")}
    ), normalized_lines AS (
      SELECT
        inv.purchase_order_id,
        inv.id AS invoice_id,
        line.id AS invoice_item_id,
        allocation.purchase_order_item_id,
        allocation.quantity AS invoice_quantity,
        allocation.subtotal AS invoice_subtotal,
        line.quantity AS document_quantity,
        line.subtotal AS document_subtotal,
        CASE lower(trim(COALESCE(line.unit_of_measure, '')))
          WHEN 'un' THEN 'unidad' WHEN 'unidad' THEN 'unidad' WHEN 'unidades' THEN 'unidad'
          WHEN 'par' THEN 'par' WHEN 'pares' THEN 'par'
          WHEN 'servicio' THEN 'servicio' WHEN 'servicios' THEN 'servicio'
          WHEN 'kg' THEN 'kg' WHEN 'kilogramo' THEN 'kg' WHEN 'kilogramos' THEN 'kg'
          ELSE NULLIF(lower(trim(COALESCE(line.unit_of_measure, ''))), '')
        END AS invoice_unit,
        item.purchase_order_id AS item_order_id,
        item.quantity AS order_quantity,
        item.subtotal AS order_subtotal,
        item.unit_price AS order_unit_price,
        CASE lower(trim(COALESCE(item.unit_of_measure, '')))
          WHEN 'un' THEN 'unidad' WHEN 'unidad' THEN 'unidad' WHEN 'unidades' THEN 'unidad'
          WHEN 'par' THEN 'par' WHEN 'pares' THEN 'par'
          WHEN 'servicio' THEN 'servicio' WHEN 'servicios' THEN 'servicio'
          WHEN 'kg' THEN 'kg' WHEN 'kilogramo' THEN 'kg' WHEN 'kilogramos' THEN 'kg'
          ELSE NULLIF(lower(trim(COALESCE(item.unit_of_measure, ''))), '')
        END AS order_unit
      FROM purchase_order_invoices inv
      JOIN purchase_order_invoice_items line ON line.invoice_id = inv.id
      LEFT JOIN allocations allocation ON allocation.invoice_item_id = line.id
      LEFT JOIN purchase_order_items item ON item.id = allocation.purchase_order_item_id
    ),
    incomplete_lines AS (
      SELECT invoice_item_id, purchase_order_id FROM normalized_lines
      GROUP BY invoice_item_id, purchase_order_id, document_quantity, document_subtotal
      HAVING COUNT(purchase_order_item_id) = 0
        OR BOOL_OR(item_order_id IS DISTINCT FROM purchase_order_id)
        OR ABS(COALESCE(SUM(invoice_quantity), 0) - document_quantity) > 0.000001
        OR ABS(COALESCE(SUM(invoice_subtotal), 0) - document_subtotal) > 1
    ),
    invoice_totals AS (
      SELECT purchase_order_id, SUM(amount) AS invoiced_total
      FROM purchase_order_invoices
      GROUP BY purchase_order_id
    ),
    quantity_totals AS (
      SELECT item.id AS order_item_id, item.purchase_order_id,
             item.quantity AS order_quantity, COALESCE(SUM(lines.invoice_quantity), 0) AS invoice_quantity
      FROM purchase_order_items item
      LEFT JOIN normalized_lines lines
        ON lines.purchase_order_item_id = item.id
       AND lines.purchase_order_id = item.purchase_order_id
      WHERE item.status <> 'cancelled'
        -- Sin esta guarda, una OC que todavía no factura nada da diferencia de
        -- cantidad contra 0 y entra a affected_orders: el diagnóstico marcaría
        -- el 100% de las OC cerradas en una base sin facturas. La conciliación
        -- sólo aplica donde ya hay factura, igual que el backfill.
        AND EXISTS (
          SELECT 1 FROM purchase_order_invoices poi
          WHERE poi.purchase_order_id = item.purchase_order_id
        )
      GROUP BY item.id, item.purchase_order_id, item.quantity
    ),
    invoice_line_quantities AS (
      SELECT invoice_id, purchase_order_id, purchase_order_item_id,
             SUM(invoice_quantity) AS invoice_quantity
      FROM normalized_lines
      WHERE purchase_order_item_id IS NOT NULL AND item_order_id = purchase_order_id
      GROUP BY invoice_id, purchase_order_id, purchase_order_item_id
    ),
    receipt_line_quantities AS (
      SELECT receipt.id AS receipt_id, receipt.purchase_order_id,
             item.purchase_order_item_id, SUM(item.quantity_received) AS received_quantity
      FROM receipts receipt
      JOIN receipt_items item ON item.receipt_id = receipt.id
      WHERE item.quantity_received > 0
      GROUP BY receipt.id, receipt.purchase_order_id, item.purchase_order_item_id
    ),
    receipt_candidates AS (
      SELECT
        inv.id AS invoice_id,
        receipt.id AS receipt_id,
        CASE WHEN ltrim(regexp_replace(COALESCE(inv.invoice_number, ''), '[^0-9]', '', 'g'), '0') <> ''
          AND ltrim(regexp_replace(COALESCE(inv.invoice_number, ''), '[^0-9]', '', 'g'), '0')
            = ltrim(regexp_replace(COALESCE(receipt.dispatch_guide_no, ''), '[^0-9]', '', 'g'), '0')
          THEN 1 ELSE 0 END AS exact_number,
        SUM(LEAST(invoice_line.invoice_quantity, receipt_line.received_quantity)) AS quantity_contribution,
        ABS(inv.issue_date::date - receipt.received_at::date) AS date_distance
      FROM purchase_order_invoices inv
      JOIN receipts receipt ON receipt.purchase_order_id = inv.purchase_order_id
      JOIN invoice_line_quantities invoice_line ON invoice_line.invoice_id = inv.id
      JOIN receipt_line_quantities receipt_line
        ON receipt_line.receipt_id = receipt.id
       AND receipt_line.purchase_order_item_id = invoice_line.purchase_order_item_id
      WHERE inv.issue_date IS NOT NULL
      GROUP BY inv.id, receipt.id, inv.invoice_number, receipt.dispatch_guide_no, inv.issue_date, receipt.received_at
      HAVING SUM(LEAST(invoice_line.invoice_quantity, receipt_line.received_quantity)) > 0.01
    ),
    ranked_receipt_candidates AS (
      SELECT candidate.*,
             DENSE_RANK() OVER (
               PARTITION BY candidate.invoice_id
               ORDER BY candidate.exact_number DESC, candidate.quantity_contribution DESC, candidate.date_distance ASC
             ) AS evidence_rank
      FROM receipt_candidates candidate
    ),
    best_receipt_candidate_counts AS (
      SELECT invoice_id, COUNT(*)::int AS candidate_count
      FROM ranked_receipt_candidates
      WHERE evidence_rank = 1
      GROUP BY invoice_id
    ),
    affected_orders AS (
      SELECT inv.purchase_order_id
      FROM purchase_order_invoices inv
      LEFT JOIN purchase_order_invoice_items line ON line.invoice_id = inv.id
      GROUP BY inv.id, inv.purchase_order_id
      HAVING COUNT(line.id) = 0
      UNION
      SELECT purchase_order_id FROM incomplete_lines
      UNION
      SELECT purchase_order_id FROM normalized_lines
      WHERE purchase_order_item_id IS NULL OR item_order_id IS DISTINCT FROM purchase_order_id
         OR invoice_unit IS NULL OR order_unit IS NULL OR invoice_unit <> order_unit
         OR order_unit_price IS NULL
         OR (invoice_unit = order_unit AND order_subtotal IS NOT NULL
             AND ABS(invoice_subtotal / NULLIF(invoice_quantity, 0) - order_subtotal / NULLIF(order_quantity, 0)) > 1)
      UNION
      SELECT purchase_order_id FROM quantity_totals
      WHERE invoice_quantity - order_quantity >= 0.01
      UNION
      SELECT po.id
      FROM purchase_orders po
      JOIN invoice_totals totals ON totals.purchase_order_id = po.id
      WHERE totals.invoiced_total - po.total_amount > 1
    )
    SELECT
      (SELECT COUNT(*)::int FROM purchase_order_invoices inv
       WHERE NOT EXISTS (SELECT 1 FROM purchase_order_invoice_items line WHERE line.invoice_id = inv.id)) AS invoices_without_lines,
      (SELECT COUNT(*)::int FROM incomplete_lines) AS unlinked_lines,
      (SELECT COUNT(*)::int FROM normalized_lines
       WHERE invoice_unit IS NOT NULL AND invoice_unit = order_unit AND order_subtotal IS NOT NULL
         AND ABS(invoice_subtotal / NULLIF(invoice_quantity, 0) - order_subtotal / NULLIF(order_quantity, 0)) > 1) AS price_variance_lines,
      (SELECT COUNT(*)::int FROM purchase_orders po
       WHERE po.status = 'closed' AND EXISTS (SELECT 1 FROM affected_orders affected WHERE affected.purchase_order_id = po.id)) AS affected_closed_orders,
      (SELECT COUNT(*)::int FROM (
        SELECT purchase_order_id FROM purchase_order_invoices GROUP BY purchase_order_id HAVING COUNT(*) > 1
      ) multiple_invoice_orders) AS orders_with_multiple_invoices,
      (SELECT COUNT(*)::int FROM (
        SELECT purchase_order_id FROM receipts GROUP BY purchase_order_id HAVING COUNT(*) > 1
      ) multiple_receipt_orders) AS orders_with_multiple_receipts,
      (SELECT COUNT(*)::int FROM best_receipt_candidate_counts WHERE candidate_count = 1) AS unique_receipt_suggestions,
      (SELECT COUNT(*)::int FROM best_receipt_candidate_counts WHERE candidate_count > 1) AS ambiguous_receipt_suggestions
  `)

  return {
    invoicesWithoutLines: Number(report?.invoices_without_lines ?? 0),
    unlinkedLines: Number(report?.unlinked_lines ?? 0),
    priceVarianceLines: Number(report?.price_variance_lines ?? 0),
    affectedClosedOrders: Number(report?.affected_closed_orders ?? 0),
    ordersWithMultipleInvoices: Number(report?.orders_with_multiple_invoices ?? 0),
    ordersWithMultipleReceipts: Number(report?.orders_with_multiple_receipts ?? 0),
    uniqueReceiptSuggestions: Number(report?.unique_receipt_suggestions ?? 0),
    ambiguousReceiptSuggestions: Number(report?.ambiguous_receipt_suggestions ?? 0),
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error("DATABASE_URL es requerido. Este preflight sólo lee la base indicada.")
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    const report = await readPurchaseInvoiceReconciliationPreflight(sql)
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await sql.end()
  }
}

// Sin extensión: en la imagen de producción este archivo corre como el bundle
// `.mjs` que genera esbuild, no como el `.ts` de este checkout.
if (process.argv[1]?.includes("preflight-purchase-invoice-reconciliation")) {
  await main()
}

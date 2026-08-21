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
}

export async function readPurchaseInvoiceReconciliationPreflight(
  sql: postgres.Sql,
): Promise<PurchaseInvoiceReconciliationPreflight> {
  const [report] = await sql.begin("read only", async (tx) => tx<{
    invoices_without_lines: number
    unlinked_lines: number
    price_variance_lines: number
    affected_closed_orders: number
  }[]>`
    WITH normalized_lines AS (
      SELECT
        inv.purchase_order_id,
        inv.id AS invoice_id,
        line.id AS invoice_item_id,
        line.purchase_order_item_id,
        line.quantity AS invoice_quantity,
        line.subtotal AS invoice_subtotal,
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
      LEFT JOIN purchase_order_items item ON item.id = line.purchase_order_item_id
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
    affected_orders AS (
      SELECT inv.purchase_order_id
      FROM purchase_order_invoices inv
      LEFT JOIN purchase_order_invoice_items line ON line.invoice_id = inv.id
      GROUP BY inv.id, inv.purchase_order_id
      HAVING COUNT(line.id) = 0
      UNION
      SELECT purchase_order_id FROM normalized_lines
      WHERE purchase_order_item_id IS NULL OR item_order_id IS DISTINCT FROM purchase_order_id
         OR invoice_unit IS NULL OR order_unit IS NULL OR invoice_unit <> order_unit
         OR order_unit_price IS NULL
         OR (invoice_unit = order_unit AND order_subtotal IS NOT NULL
             AND ABS(invoice_subtotal / NULLIF(invoice_quantity, 0) - order_subtotal / NULLIF(order_quantity, 0)) > 1)
      UNION
      SELECT purchase_order_id FROM quantity_totals
      WHERE ABS(order_quantity - invoice_quantity) >= 0.01
      UNION
      SELECT po.id
      FROM purchase_orders po
      JOIN invoice_totals totals ON totals.purchase_order_id = po.id
      WHERE ABS(totals.invoiced_total - po.total_amount) > 1
    )
    SELECT
      (SELECT COUNT(*)::int FROM purchase_order_invoices inv
       WHERE NOT EXISTS (SELECT 1 FROM purchase_order_invoice_items line WHERE line.invoice_id = inv.id)) AS invoices_without_lines,
      (SELECT COUNT(*)::int FROM normalized_lines
       WHERE purchase_order_item_id IS NULL OR item_order_id IS DISTINCT FROM purchase_order_id) AS unlinked_lines,
      (SELECT COUNT(*)::int FROM normalized_lines
       WHERE invoice_unit IS NOT NULL AND invoice_unit = order_unit AND order_subtotal IS NOT NULL
         AND ABS(invoice_subtotal / NULLIF(invoice_quantity, 0) - order_subtotal / NULLIF(order_quantity, 0)) > 1) AS price_variance_lines,
      (SELECT COUNT(*)::int FROM purchase_orders po
       WHERE po.status = 'closed' AND EXISTS (SELECT 1 FROM affected_orders affected WHERE affected.purchase_order_id = po.id)) AS affected_closed_orders
  `)

  return {
    invoicesWithoutLines: Number(report?.invoices_without_lines ?? 0),
    unlinkedLines: Number(report?.unlinked_lines ?? 0),
    priceVarianceLines: Number(report?.price_variance_lines ?? 0),
    affectedClosedOrders: Number(report?.affected_closed_orders ?? 0),
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

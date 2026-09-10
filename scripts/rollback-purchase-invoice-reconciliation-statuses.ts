import postgres from "postgres"

/**
 * Compatibilidad para volver temporalmente a una versión que aún no conoce
 * `partially_invoiced` ni `awaiting_receipt`. Debe ejecutarse antes del rollback
 * del esquema/código; no elimina facturas, recepciones ni asociaciones.
 */
export async function mapNewInvoiceReconciliationStatusesForRollback(sql: postgres.Sql) {
  const rows = await sql.begin("read write", async (tx) => tx<{ id: string }[]>`
    UPDATE purchase_orders
    SET invoice_reconciliation_status = 'needs_review',
        invoice_reconciliation_fingerprint = NULL,
        invoice_reconciliation_updated_at = NOW(),
        updated_at = NOW()
    WHERE invoice_reconciliation_status IN ('partially_invoiced', 'awaiting_receipt')
    RETURNING id
  `)
  return { mappedOrders: rows.length }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error("DATABASE_URL es requerido para preparar el rollback")
  const sql = postgres(databaseUrl, { max: 1 })
  try {
    console.log(JSON.stringify(await mapNewInvoiceReconciliationStatusesForRollback(sql), null, 2))
  } finally {
    await sql.end()
  }
}

// Sin `await` de nivel superior: el runner transpila a CJS y ahí el top-level
// await es un error de transformación, así que el script fallaba antes de
// abrir la conexión.
if (process.argv[1]?.includes("rollback-purchase-invoice-reconciliation-statuses")) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}

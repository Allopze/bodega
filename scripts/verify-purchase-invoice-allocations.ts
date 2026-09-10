import postgres from "postgres"

/**
 * Verificación estructural de las asignaciones N:N entre líneas de comprobante
 * y líneas de OC.
 *
 * Corre después de migrar, nunca antes: sin la tabla de asignaciones no hay
 * nada que verificar. La transacción READ ONLY convierte la promesa de este
 * script en una garantía del propio PostgreSQL.
 *
 * Sólo emite conteos. Los montos, folios y proveedores de una factura no
 * pertenecen a la salida de un gate de release, que queda en logs de CI.
 */
export interface PurchaseInvoiceAllocationReport {
  /** Filas 1:1 heredadas cuyo backfill no dejó la asignación equivalente. */
  legacyRowsWithoutAllocation: number
  /** Asignaciones que apuntan a una línea de otra orden de compra. */
  crossOrderAllocations: number
  /** Asignaciones cuyo signo contradice al de la línea del comprobante. */
  signMismatchedAllocations: number
  /** Líneas repartidas por encima de la cantidad o el monto que facturan. */
  overAllocatedInvoiceLines: number
  /**
   * Espejo de compatibilidad que contradice a su única asignación.
   *
   * Se solapa con `legacyRowsWithoutAllocation` por construcción: un espejo que
   * apunta a otra línea tampoco tiene su asignación equivalente. Se cuentan por
   * separado porque describen fallas distintas — aquí hubo un reparto y el
   * espejo quedó mintiendo; allá el reparto puede no existir en absoluto — y un
   * conteo agregado no diría cuál de las dos hay que reparar.
   */
  inconsistentCompatibilityMirrors: number
}

export async function verifyPurchaseInvoiceAllocations(
  sql: postgres.Sql,
): Promise<PurchaseInvoiceAllocationReport> {
  const [report] = await sql.begin("read only", async (tx) => tx<{
    legacy_rows_without_allocation: number
    cross_order_allocations: number
    sign_mismatched_allocations: number
    over_allocated_invoice_lines: number
    inconsistent_compatibility_mirrors: number
  }[]>`
    SELECT
      (
        SELECT count(*) FROM purchase_order_invoice_items pii
        WHERE pii.purchase_order_item_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM purchase_order_invoice_item_allocations a
            WHERE a.invoice_item_id = pii.id
              AND a.purchase_order_item_id = pii.purchase_order_item_id
          )
      ) AS legacy_rows_without_allocation,

      -- La orden de la línea asignada tiene que ser la orden de la factura.
      (
        SELECT count(*) FROM purchase_order_invoice_item_allocations a
        JOIN purchase_order_invoice_items pii ON pii.id = a.invoice_item_id
        JOIN purchase_order_invoices pi ON pi.id = pii.invoice_id
        JOIN purchase_order_items poi ON poi.id = a.purchase_order_item_id
        WHERE poi.purchase_order_id <> pi.purchase_order_id
      ) AS cross_order_allocations,

      -- Una nota de crédito reparte en negativo; una factura, en positivo.
      (
        SELECT count(*) FROM purchase_order_invoice_item_allocations a
        JOIN purchase_order_invoice_items pii ON pii.id = a.invoice_item_id
        WHERE sign(a.quantity) <> sign(pii.quantity)
           OR sign(a.subtotal) <> sign(pii.subtotal)
      ) AS sign_mismatched_allocations,

      -- Comparación en valor absoluto: el exceso importa igual en una NC.
      -- La tolerancia de 0.01 absorbe el redondeo de numeric(12,2).
      (
        SELECT count(*) FROM (
          SELECT pii.id
          FROM purchase_order_invoice_items pii
          JOIN purchase_order_invoice_item_allocations a ON a.invoice_item_id = pii.id
          GROUP BY pii.id, pii.quantity, pii.subtotal
          HAVING abs(sum(a.quantity)) > abs(pii.quantity) + 0.000001
              OR abs(sum(a.subtotal)) > abs(pii.subtotal) + 0.01
        ) AS over_allocated
      ) AS over_allocated_invoice_lines,

      -- El espejo 1:1 sólo tiene sentido cuando hay exactamente una asignación:
      -- una línea repartida entre varias OC no puede apuntar a una sola.
      (
        SELECT count(*) FROM (
          SELECT pii.id
          FROM purchase_order_invoice_items pii
          JOIN purchase_order_invoice_item_allocations a ON a.invoice_item_id = pii.id
          WHERE pii.purchase_order_item_id IS NOT NULL
          GROUP BY pii.id, pii.purchase_order_item_id
          HAVING count(*) = 1
             AND min(a.purchase_order_item_id) <> pii.purchase_order_item_id
        ) AS inconsistent_mirrors
      ) AS inconsistent_compatibility_mirrors
  `)

  return {
    legacyRowsWithoutAllocation: Number(report!.legacy_rows_without_allocation),
    crossOrderAllocations: Number(report!.cross_order_allocations),
    signMismatchedAllocations: Number(report!.sign_mismatched_allocations),
    overAllocatedInvoiceLines: Number(report!.over_allocated_invoice_lines),
    inconsistentCompatibilityMirrors: Number(report!.inconsistent_compatibility_mirrors),
  }
}

const LABELS: Record<keyof PurchaseInvoiceAllocationReport, string> = {
  legacyRowsWithoutAllocation: "Filas 1:1 heredadas sin su asignación",
  crossOrderAllocations: "Asignaciones a líneas de otra orden",
  signMismatchedAllocations: "Asignaciones con signo contradictorio",
  overAllocatedInvoiceLines: "Líneas repartidas por sobre lo facturado",
  inconsistentCompatibilityMirrors: "Espejos 1:1 que contradicen su asignación",
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error("DATABASE_URL es obligatorio para verificar las asignaciones")
    process.exit(1)
  }

  const sql = postgres(databaseUrl, { max: 1 })
  try {
    let report: PurchaseInvoiceAllocationReport
    try {
      report = await verifyPurchaseInvoiceAllocations(sql)
    } catch (error) {
      // 42P01 = undefined_table. Correr el gate antes de migrar es un error de
      // orden en el pipeline, no una inconsistencia de datos: decirlo así evita
      // que alguien lea un stack de Postgres como si fuera un hallazgo.
      if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
        console.error("Falta la tabla de asignaciones: ejecuta las migraciones antes de este gate.")
        process.exit(1)
      }
      throw error
    }
    const entries = Object.entries(report) as [keyof PurchaseInvoiceAllocationReport, number][]

    console.log("Verificación de asignaciones OC-factura")
    for (const [key, value] of entries) console.log(`  ${LABELS[key]}: ${value}`)

    const failed = entries.filter(([, value]) => value > 0)
    if (failed.length > 0) {
      console.error(`\n${failed.length} verificación(es) con inconsistencias estructurales.`)
      process.exit(1)
    }
    console.log("\nSin inconsistencias estructurales.")
  } finally {
    await sql.end()
  }
}

// El test importa `verifyPurchaseInvoiceAllocations` sin abrir una conexión.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

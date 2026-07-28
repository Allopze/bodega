/**
 * Preflight de reconciliación EPP, estrictamente de solo lectura.
 *
 * Compara el saldo agregado por faena/producto contra los lotes EPP vigentes.
 * Una fila reportada no se corrige automáticamente: requiere inventario físico
 * y trazabilidad de recepción antes de habilitar entregas FEFO.
 *
 * Uso:
 *   DATABASE_URL=postgres://... npx tsx scripts/verify-epp-lot-reconciliation.ts
 */

import postgres from "postgres"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL es requerido")

type SchemaRow = { inventory_lots: string | null }
type ReconciliationRow = {
  worksite_name: string
  sku: string | null
  product_name: string
  aggregate_stock: number
  all_lot_stock: number
  valid_lot_stock: number
  uncovered_stock: number
}

const sql = postgres(databaseUrl, { max: 1 })

async function main() {
  // Prevent accidental writes even if this script is extended in the future.
  await sql.unsafe("SET default_transaction_read_only = on")

  const [schema] = await sql<SchemaRow[]>`
    select to_regclass('public.inventory_lots') as inventory_lots
  `
  if (!schema?.inventory_lots) {
    throw new Error(
      "La tabla inventory_lots no existe. Publica la release completa y ejecuta db:migrate antes de reconciliar EPP.",
    )
  }

  const rows = await sql<ReconciliationRow[]>`
    with lotes as (
      select
        worksite_id,
        product_id,
        coalesce(sum(quantity_available), 0)::float8 as all_lot_stock,
        coalesce(sum(quantity_available) filter (where expires_at > current_date::text), 0)::float8 as valid_lot_stock
      from inventory_lots
      group by worksite_id, product_id
    )
    select
      w.name as worksite_name,
      p.sku,
      p.name as product_name,
      ws.quantity::float8 as aggregate_stock,
      coalesce(l.all_lot_stock, 0)::float8 as all_lot_stock,
      coalesce(l.valid_lot_stock, 0)::float8 as valid_lot_stock,
      (ws.quantity - coalesce(l.valid_lot_stock, 0))::float8 as uncovered_stock
    from worksite_stock ws
    join products p on p.id = ws.product_id
    join worksites w on w.id = ws.worksite_id
    left join lotes l on l.worksite_id = ws.worksite_id and l.product_id = ws.product_id
    where p.is_epp = true
      and ws.quantity > coalesce(l.valid_lot_stock, 0)
    order by w.name, p.name
  `

  if (rows.length === 0) {
    console.log("[verify:epp-lots] OK: todo saldo EPP agregado está cubierto por lotes vigentes")
    return
  }

  console.error(`[verify:epp-lots] ERROR: ${rows.length} saldo(s) EPP no están cubiertos por lotes vigentes`)
  console.table(rows)
  process.exitCode = 1
}

main()
  .catch((error) => {
    console.error("[verify:epp-lots] falló:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => {})
  })

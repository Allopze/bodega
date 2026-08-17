import { and, eq, gt } from "drizzle-orm"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { db } from "@/db"
import { products, worksiteStock, worksites } from "@/db/schema"

/**
 * Existencias atrapadas en faenas cerradas.
 *
 * Desactivar una faena nunca movió su stock, y `applyMovementTx` rechaza todo
 * movimiento sobre faena inactiva: ese saldo no se ve en Bodega ni se puede
 * sacar. Sólo lectura — decidir qué se hace con cada saldo (devolverlo a
 * Oficina, desecharlo) es una decisión de negocio, no un UPDATE a ciegas.
 */
export interface OrphanStockRow {
  worksiteId: string
  worksiteCode: string
  worksiteName: string
  productId: string
  productSku: string | null
  productName: string
  quantity: number
  unitOfMeasure: string
}

export async function findOrphanStock(): Promise<OrphanStockRow[]> {
  return db.select({
    worksiteId:    worksites.id,
    worksiteCode:  worksites.code,
    worksiteName:  worksites.name,
    productId:     products.id,
    productSku:    products.sku,
    productName:   products.name,
    quantity:      worksiteStock.quantity,
    unitOfMeasure: products.unitOfMeasure,
  })
    .from(worksiteStock)
    .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
    .innerJoin(products, eq(worksiteStock.productId, products.id))
    .where(and(eq(worksites.isActive, false), gt(worksiteStock.quantity, 0)))
    .orderBy(worksites.name, products.name)
}

async function main() {
  const rows = await findOrphanStock()
  if (rows.length === 0) {
    console.log("Sin existencias atrapadas: ninguna faena cerrada tiene saldo.")
    return
  }

  const byWorksite = new Map<string, OrphanStockRow[]>()
  for (const row of rows) {
    byWorksite.set(row.worksiteId, [...(byWorksite.get(row.worksiteId) ?? []), row])
  }

  console.log(`${rows.length} existencia(s) atrapada(s) en ${byWorksite.size} faena(s) cerrada(s):\n`)
  for (const items of byWorksite.values()) {
    const first = items[0]
    if (!first) continue
    console.log(`${first.worksiteName} (${first.worksiteCode}) — ${items.length} producto(s)`)
    for (const item of items) {
      const sku = item.productSku ? `${item.productSku} · ` : ""
      console.log(`  ${sku}${item.productName}: ${item.quantity} ${item.unitOfMeasure}`)
    }
    console.log("")
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}

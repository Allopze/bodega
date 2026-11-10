import { sql } from "drizzle-orm"
import type { DB, Tx } from "@/db"
import { products } from "@/db/schema"

/**
 * Prefijos de SKU de catálogo: `EPP-NNN` (EPP), `PRD-NNN` (resto) y `RPT-NNN`
 * (repuestos de catálogo; no `REP-`, que es el código de las solicitudes de
 * repuestos).
 */
export type ProductSkuPrefix = "EPP" | "PRD" | "RPT"

/**
 * Genera `count` SKU secuenciales dentro de una transacción.
 *
 * Usa secuencias numéricas consecutivas por prefijo: EPP-001, EPP-002, ...
 * El arranque se calcula desde el máximo existente en la BD para el prefijo
 * dado, de modo que siempre continúa la secuencia sin colisiones.
 *
 * El segundo argumento acepta el booleano histórico `isEpp` (true → EPP,
 * false → PRD) o el prefijo explícito.
 *
 * Dentro de una transacción de lote variantes, el `Set` local evita
 * duplicados si dos lotes concurrentes leen el mismo max al inicio.
 */
export async function generateUniqueSkus(
  client: DB | Tx,
  count: number,
  prefixOrIsEpp: boolean | ProductSkuPrefix,
): Promise<string[]> {
  const prefix: ProductSkuPrefix = typeof prefixOrIsEpp === "string"
    ? prefixOrIsEpp
    : prefixOrIsEpp ? "EPP" : "PRD"

  const rows = await client
    .select({ sku: products.sku })
    .from(products)
    .where(sql`${products.sku} LIKE ${prefix + "-%"}`)

  let maxNum = 0
  for (const row of rows) {
    const num = parseInt(row.sku.slice(prefix.length + 1), 10)
    if (!isNaN(num) && num > maxNum) maxNum = num
  }

  const generated: string[] = []
  for (let i = 0; i < count; i++) {
    maxNum++
    generated.push(`${prefix}-${String(maxNum).padStart(3, "0")}`)
  }
  return generated
}

export async function generateUniqueProductSku(client: DB | Tx, prefixOrIsEpp: boolean | ProductSkuPrefix) {
  const [sku] = await generateUniqueSkus(client, 1, prefixOrIsEpp)
  return sku!
}

import { nanoid } from "@/lib/id"
import { buildEppFamilyIdentityKey } from "@/lib/services/epp-import"
import { type DB, type Tx } from "@/db"
import { eppProductFamilies, products, productCategories } from "@/db/schema"
import { eq, sql } from "drizzle-orm"

export const REVALIDATE = "/admin/productos"

export function formString(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

export function normalizeSelectOptions(options: string | null | undefined): string | null {
  if (!options) return null

  let values: unknown[] | null = null
  try {
    const parsed = JSON.parse(options)
    if (Array.isArray(parsed)) values = parsed
  } catch {
    values = null
  }

  const rawItems = values ?? options.split(/[,\n]+/)
  const items = rawItems
    .map((item) => String(item).trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)

  return items.length > 0 ? JSON.stringify(items) : null
}

export function displayOptionsText(options: string | null): string {
  if (!options) return ""
  try {
    const parsed = JSON.parse(options)
    if (Array.isArray(parsed)) return parsed.map((item) => String(item)).join(", ")
  } catch {
    // Keep legacy comma/newline text editable as-is.
  }
  return options
}

/**
 * Genera `count` SKU secuenciales dentro de una transacción.
 *
 * Usa secuencias numéricas consecutivas: EPP-001, EPP-002, ... (EPP)
 * o PRD-001, PRD-002, ... (no-EPP). El arranque se calcula desde el máximo
 * existente en la BD para el prefijo dado, de modo que siempre continúa la
 * secuencia sin colisiones.
 *
 * Dentro de una transacción de lote variantes, el `Set` local evita
 * duplicados si dos lotes concurrentes leen el mismo max al inicio.
 */
export async function generateUniqueSkus(client: DB | Tx, count: number, isEpp: boolean): Promise<string[]> {
  const prefix = isEpp ? "EPP" : "PRD"

  const rows = await client
    .select({ sku: products.sku })
    .from(products)
    .where(sql`${products.sku} LIKE ${prefix + '-%'}`)

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

export async function generateUniqueProductSku(client: DB | Tx, isEpp: boolean) {
  const [sku] = await generateUniqueSkus(client, 1, isEpp)
  return sku!
}

/**
 * Devuelve la familia con esa identidad, creándola si aún no existe.
 *
 * A prueba de carreras: entre el SELECT y el INSERT otra transacción puede
 * crear la misma identidad (`identity_key` es UNIQUE), y ese 23505 llegaba
 * crudo al usuario —dos personas dando de alta el mismo EPP a la vez es un
 * escenario perfectamente normal—. `onConflictDoNothing` + relectura hace que
 * el que pierde la carrera se sume a la familia del que la ganó, que es lo que
 * corresponde: la identidad es justamente lo que las declara la misma.
 */
export async function ensureEppFamilyTx(
  tx: Tx,
  input: { categoryId: string; categoryName: string; canonicalName: string },
): Promise<{ id: string }> {
  const identityKey = buildEppFamilyIdentityKey({
    categoryName: input.categoryName,
    canonicalName: input.canonicalName,
    brand: null,
    model: null,
  })

  const existing = await tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.identityKey, identityKey) })
  if (existing) return existing

  const [inserted] = await tx.insert(eppProductFamilies)
    .values({
      id: nanoid(), categoryId: input.categoryId, canonicalName: input.canonicalName,
      identityKey, eppType: null, brand: null, model: null,
    })
    .onConflictDoNothing({ target: eppProductFamilies.identityKey })
    .returning({ id: eppProductFamilies.id })
  if (inserted) return inserted

  const winner = await tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.identityKey, identityKey) })
  if (!winner) throw new Error("No se pudo resolver la familia de EPP")
  return winner
}

export async function resolveManualEppFamily(tx: Tx, input: { categoryId: string; name: string; isEpp: boolean }) {
  if (!input.isEpp) return null
  const category = await tx.query.productCategories.findFirst({ where: eq(productCategories.id, input.categoryId) })
  if (!category) return null
  return ensureEppFamilyTx(tx, { categoryId: input.categoryId, categoryName: category.name, canonicalName: input.name })
}

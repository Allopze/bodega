import { nanoid } from "@/lib/id"
import { buildEppFamilyIdentityKey } from "@/lib/services/epp-import"
import { type DB, type Tx } from "@/db"
import { eppProductFamilies, products, productCategories } from "@/db/schema"
import { eq } from "drizzle-orm"

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
 * Genera `count` SKU únicos de una sola consulta.
 *
 * Recibe el cliente en vez de tomar `db` del módulo por dos razones:
 *  - el lote de variantes corre dentro de una transacción, y consultar por
 *    fuera no ve sus propias filas sin commitear (y con un driver de conexión
 *    única, como PGlite en las pruebas, directamente se autobloquea);
 *  - los SKU se deduplican **dentro** del lote con un `Set` local: antes cada
 *    uno se comprobaba sólo contra la BD, así que dos variantes del mismo lote
 *    podían sacar el mismo nanoid y reventar toda la transacción con un error
 *    de constraint crudo en vez de un mensaje.
 */
export async function generateUniqueSkus(client: DB | Tx, count: number, isEpp: boolean): Promise<string[]> {
  const prefix = isEpp ? "EPP" : "PRD"
  const existing = await client.select({ sku: products.sku }).from(products)
  const taken = new Set(existing.map((row) => row.sku))

  const generated: string[] = []
  for (let i = 0; i < count; i++) {
    let sku: string | null = null
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = `${prefix}-${nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`
      if (taken.has(candidate)) continue
      sku = candidate
      break
    }
    if (!sku) throw new Error("No se pudo generar un SKU único")
    taken.add(sku)
    generated.push(sku)
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

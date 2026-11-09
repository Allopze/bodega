import { nanoid } from "@/lib/id"
import { buildEppFamilyIdentityKey } from "@/lib/services/epp-import"
import { classifyEppTypeIdByName } from "@/lib/services/epp-type-classification"
import { type DB, type Tx } from "@/db"
import { eppProductFamilies, productCategories } from "@/db/schema"
import { eq } from "drizzle-orm"
import { isSparePartsCategory } from "@/lib/products/spare-parts-category"

export const REVALIDATE = "/admin/productos"

/**
 * Catálogo de repuestos: la categoría «Repuestos» no admite productos comunes
 * (`lib/products/spare-parts-category.ts`). Se resuelve por slug, como la busca
 * `createSparePartTx`, no por el id sembrado.
 */
export async function isSparePartsCategoryId(client: DB | Tx, categoryId: string): Promise<boolean> {
  const category = await client.query.productCategories.findFirst({
    where: eq(productCategories.id, categoryId),
    columns: { slug: true },
  })
  return isSparePartsCategory(category)
}

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

// El generador de SKU vive en `lib/products/product-skus.ts` para que los
// servicios de `lib/` (catálogo de repuestos) lo usen sin importar desde `app/`.
export { generateUniqueSkus, generateUniqueProductSku } from "@/lib/products/product-skus"

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
  if (existing) {
    // Igual que el importador: una familia ya clasificada por cualquier vía
    // conserva su tipo; sólo se rellena la que está sin clasificar.
    if (!existing.eppTypeId) {
      const eppTypeId = await classifyEppTypeIdByName(tx, input.canonicalName)
      if (eppTypeId) {
        await tx.update(eppProductFamilies).set({ eppTypeId }).where(eq(eppProductFamilies.id, existing.id))
      }
    }
    return existing
  }

  // Antes se insertaba con `eppTypeId` nulo sin siquiera intentar inferirlo:
  // sólo el import XLSX clasificaba, así que todo lo creado a mano nacía
  // invisible para la cobertura de Prevención.
  const eppTypeId = await classifyEppTypeIdByName(tx, input.canonicalName)

  const [inserted] = await tx.insert(eppProductFamilies)
    .values({
      id: nanoid(), categoryId: input.categoryId, canonicalName: input.canonicalName,
      identityKey, eppType: null, eppTypeId, brand: null, model: null,
    })
    .onConflictDoNothing({ target: eppProductFamilies.identityKey })
    .returning({ id: eppProductFamilies.id })
  if (inserted) return inserted

  const winner = await tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.identityKey, identityKey) })
  if (!winner) throw new Error("No se pudo resolver la familia de EPP")
  return winner
}

/** Ficha que el asistente puede declarar al crear el producto EPP. */
export interface EppFamilyFichaInput {
  certification?: string | null
  lifespanMonths?: number | null
  lifespanNotApplicable?: boolean
}

export async function resolveManualEppFamily(
  tx: Tx,
  input: { categoryId: string; name: string; isEpp: boolean },
  ficha?: EppFamilyFichaInput,
) {
  if (!input.isEpp) return null
  const category = await tx.query.productCategories.findFirst({ where: eq(productCategories.id, input.categoryId) })
  if (!category) return null
  const family = await ensureEppFamilyTx(tx, { categoryId: input.categoryId, categoryName: category.name, canonicalName: input.name })
  if (ficha) await applyEppFamilyFichaTx(tx, family.id, ficha)
  return family
}

/**
 * Completa la ficha de la familia **sólo en los campos que están vacíos**.
 *
 * Dar de alta la segunda variante de una familia no debe reescribir en silencio
 * una certificación o una vida útil que alguien ya revisó en /admin/epps; pero
 * dejar el dato en el aire cuando la familia no lo tiene tampoco sirve. Mismo
 * criterio que la fusión de familias.
 */
export async function applyEppFamilyFichaTx(tx: Tx, familyId: string, ficha: EppFamilyFichaInput) {
  const certification = ficha.certification?.trim() || null
  const hasLifespan = ficha.lifespanMonths != null
  if (!certification && !hasLifespan && !ficha.lifespanNotApplicable) return

  const current = await tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.id, familyId) })
  if (!current) return

  const patch: Partial<typeof eppProductFamilies.$inferInsert> = {}
  if (certification && !current.certification?.trim()) patch.certification = certification
  if (hasLifespan && current.lifespanMonths == null) patch.lifespanMonths = ficha.lifespanMonths!
  if (ficha.lifespanNotApplicable && current.lifespanMonths == null && !current.lifespanNotApplicable) {
    patch.lifespanNotApplicable = true
  }
  if (Object.keys(patch).length === 0) return

  await tx.update(eppProductFamilies)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(eppProductFamilies.id, familyId))
}

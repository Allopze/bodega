import { nanoid } from "@/lib/id"
import { buildEppFamilyIdentityKey } from "@/lib/services/epp-import"
import { db } from "@/db"
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

export async function generateUniqueProductSku(isEpp: boolean) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, "X")
    const sku = `${isEpp ? "EPP" : "PRD"}-${suffix}`
    const existing = await db.query.products.findFirst({ where: eq(products.sku, sku) })
    if (!existing) return sku
  }

  throw new Error("No se pudo generar un SKU único")
}

export async function generateUniqueSkus(count: number, isEpp: boolean): Promise<string[]> {
  const skus: string[] = []
  for (let i = 0; i < count; i++) {
    skus.push(await generateUniqueProductSku(isEpp))
  }
  return skus
}

export async function resolveManualEppFamily(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], input: { categoryId: string; name: string; isEpp: boolean }) {
  if (!input.isEpp) return null
  const category = await tx.query.productCategories.findFirst({ where: eq(productCategories.id, input.categoryId) })
  if (!category) return null
  const identityKey = buildEppFamilyIdentityKey({ categoryName: category.name, canonicalName: input.name, brand: null, model: null })
  const existing = await tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.identityKey, identityKey) })
  if (existing) return existing
  const id = nanoid()
  await tx.insert(eppProductFamilies).values({ id, categoryId: input.categoryId, canonicalName: input.name, identityKey, eppType: null, brand: null, model: null })
  return { id }
}

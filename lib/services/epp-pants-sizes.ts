/**
 * Backfill: asegura que toda familia de pantalones del catálogo EPP tenga
 * variantes para S, M, L, XL y 2XL.
 *
 * El catálogo real distingue pantalones por la escala de ropa en el atributo
 * "Talla" (ver `db/seed/epp-catalog.json`: "Pantalón Lightwind... T-XL" /
 * "...T-2XL"), pero nada obliga a que una familia nazca con las cinco tallas
 * completas — el importador XLSX sólo crea la fila que trae la planilla. Este
 * backfill completa las que falten, clonando el resto de los atributos
 * (marca/modelo/color, unidad, flags, proveedor preferente) de una variante ya
 * existente: no hay otra fuente de esos valores para una talla que nunca se
 * compró.
 *
 * Sólo actúa sobre familias que YA usan "Talla" (la escala de ropa) en alguna
 * variante existente. Una familia de pantalón sin ese atributo, o que use
 * "Talla inferior" (la escala numérica de cintura del padrón de
 * trabajadores, ver `lib/products/size-catalog.ts`), no tiene precedente de
 * qué escala usar y se deja intacta.
 */
import { eq, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { eppProductFamilies, products, productAttributes, productSuppliers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { normalizeAttributeName } from "@/lib/products/attribute-names"
import { resolveProductSize, normalizeSizeLabel } from "@/lib/products/product-size"

export const PANTS_TARGET_SIZES = ["S", "M", "L", "XL", "2XL"] as const

export interface PantsFamilySyncResult {
  familyId: string
  familyName: string
  status: "created" | "skipped_no_talla_attribute" | "already_complete"
  createdSizes: string[]
}

export interface PantsSizeSyncSummary {
  familiesScanned: number
  variantsCreated: number
  results: PantsFamilySyncResult[]
}

/** Siguiente SKU secuencial `EPP-NNN` visto desde dentro de la transacción. */
async function nextEppSku(tx: Tx): Promise<string> {
  const rows = await tx.select({ sku: products.sku }).from(products).where(sql`${products.sku} LIKE 'EPP-%'`)
  let max = 0
  for (const row of rows) {
    const num = parseInt(row.sku.slice(4), 10)
    if (!Number.isNaN(num) && num > max) max = num
  }
  return `EPP-${String(max + 1).padStart(3, "0")}`
}

async function syncFamily(tx: Tx, family: { id: string; canonicalName: string }): Promise<PantsFamilySyncResult> {
  const variants = await tx.query.products.findMany({
    where: eq(products.familyId, family.id),
    with: {
      productAttributes: { orderBy: (a, { asc }) => [asc(a.sortOrder)] },
      productSuppliers: { orderBy: (ps, { desc }) => [desc(ps.isPreferred)] },
    },
  })

  // Busca la variante que ya declara "Talla" (escala de ropa) para usarla de
  // plantilla y para saber qué tallas ya existen.
  let sizeAttrName: string | null = null
  let templateVariant: (typeof variants)[number] | null = null
  const existingLabels = new Set<string>()
  for (const variant of variants) {
    const size = resolveProductSize(variant.productAttributes)
    if (!size || normalizeAttributeName(size.attributeName) !== "talla") continue
    sizeAttrName ??= size.attributeName
    templateVariant ??= variant
    existingLabels.add(normalizeSizeLabel(size.label))
  }

  if (!sizeAttrName || !templateVariant) {
    return { familyId: family.id, familyName: family.canonicalName, status: "skipped_no_talla_attribute", createdSizes: [] }
  }

  const missingSizes = PANTS_TARGET_SIZES.filter((size) => !existingLabels.has(normalizeSizeLabel(size)))
  if (missingSizes.length === 0) {
    return { familyId: family.id, familyName: family.canonicalName, status: "already_complete", createdSizes: [] }
  }

  const templateSizeAttr = templateVariant.productAttributes.find(
    (attr) => normalizeAttributeName(attr.name) === normalizeAttributeName(sizeAttrName!),
  )!
  const templateOtherAttrs = templateVariant.productAttributes.filter((attr) => attr.id !== templateSizeAttr.id)
  const preferredSupplier = templateVariant.productSuppliers.find((ps) => ps.isPreferred) ?? templateVariant.productSuppliers[0] ?? null

  const createdSizes: string[] = []
  for (const size of missingSizes) {
    const sku = await nextEppSku(tx)
    const productId = nanoid()

    await tx.insert(products).values({
      id: productId,
      sku,
      name: templateVariant.name,
      description: templateVariant.description,
      categoryId: templateVariant.categoryId,
      familyId: family.id,
      unitOfMeasure: templateVariant.unitOfMeasure,
      isEpp: templateVariant.isEpp,
      requiresPrevencion: templateVariant.requiresPrevencion,
      isService: templateVariant.isService,
      requiresWorker: templateVariant.requiresWorker,
      equipmentKind: templateVariant.equipmentKind,
      referencePrice: templateVariant.referencePrice,
      isActive: templateVariant.isActive,
      notes: templateVariant.notes,
    })

    if (templateOtherAttrs.length > 0) {
      await tx.insert(productAttributes).values(templateOtherAttrs.map((attr) => ({
        id: nanoid(), productId, categoryId: null,
        name: attr.name, type: attr.type, isRequired: attr.isRequired,
        options: attr.options, sizeFamily: attr.sizeFamily,
        drivesQuantity: attr.drivesQuantity, sortOrder: attr.sortOrder,
      })))
    }

    await tx.insert(productAttributes).values({
      id: nanoid(), productId, categoryId: null,
      name: sizeAttrName, type: "select", isRequired: true,
      options: JSON.stringify([size]),
      sizeFamily: templateSizeAttr.sizeFamily,
      drivesQuantity: false,
      sortOrder: templateSizeAttr.sortOrder,
    })

    if (preferredSupplier) {
      await tx.insert(productSuppliers).values({
        id: nanoid(), productId, supplierId: preferredSupplier.supplierId,
        unitPrice: preferredSupplier.unitPrice, isPreferred: true, notes: preferredSupplier.notes,
      })
    }

    createdSizes.push(size)
  }

  return { familyId: family.id, familyName: family.canonicalName, status: "created", createdSizes }
}

/**
 * Idempotente: familias ya completas o sin la escala "Talla" no se tocan, y
 * volver a correrlo no duplica variantes.
 */
export async function addMissingPantsSizeVariants(): Promise<PantsSizeSyncSummary> {
  const families = await db.query.eppProductFamilies.findMany({
    where: eq(eppProductFamilies.eppType, "pantalon"),
  })

  const results: PantsFamilySyncResult[] = []
  for (const family of families) {
    results.push(await db.transaction((tx) => syncFamily(tx, family)))
  }

  return {
    familiesScanned: families.length,
    variantsCreated: results.reduce((sum, r) => sum + r.createdSizes.length, 0),
    results,
  }
}

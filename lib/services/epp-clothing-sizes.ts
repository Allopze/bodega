/**
 * Backfill: asegura que toda familia EPP **declarada** de la escala de ropa
 * (`product_attributes.size_family = 'ropa'`: XS, S, M, L, XL, 2XL) tenga las
 * seis tallas completas.
 *
 * No se filtra por `epp_product_families.epp_type` porque esa columna está
 * deprecada y casi siempre nula (la creación manual y el asistente de
 * variantes nunca la escriben — sólo el importador XLSX).
 *
 * El criterio **no** puede ser el nombre del atributo. Fue el original, y
 * alcanzaba a todo el catálogo importado: el importador nombraba `Talla` a
 * cualquier eje, así que un botín `N41`, un guante `N-9` y una capa `Única`
 * pasaban el filtro y recibían seis variantes de ropa inventadas — 33
 * familias y 158 variantes, medido sobre bodega_dev. La familia declarada es
 * la única señal que distingue una escala de otra, y es la que el importador
 * ya empezó a escribir.
 *
 * Consecuencia deliberada: mientras `size_family` siga NULL en el catálogo
 * histórico, este backfill no toca nada. Es lo correcto — no hay forma de
 * saber si una familia es de ropa sin que el dato lo diga.
 *
 * Cada talla nueva clona el resto de los atributos (marca/modelo/color,
 * unidad, flags, proveedor preferente) de una variante ya existente de la
 * misma familia: no hay otra fuente de esos valores para una talla que nunca
 * se compró.
 */
import { sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { products, productAttributes, productSuppliers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { normalizeAttributeName } from "@/lib/products/attribute-names"
import { resolveProductSize, normalizeSizeLabel } from "@/lib/products/product-size"

export const CLOTHING_TARGET_SIZES = ["XS", "S", "M", "L", "XL", "2XL"] as const

/** Única familia de `size_catalog` cuya escala este backfill sabe completar. */
export const CLOTHING_SIZE_FAMILY = "ropa"

export interface ClothingFamilySyncResult {
  familyId: string
  familyName: string
  status: "created" | "already_complete"
  createdSizes: string[]
}

export interface ClothingSizeSyncSummary {
  familiesScanned: number
  variantsCreated: number
  /** `true` cuando sólo se informó lo que se crearía, sin escribir. */
  dryRun: boolean
  results: ClothingFamilySyncResult[]
}

export interface ClothingSizeSyncOptions {
  /** Calcula e informa las tallas faltantes sin insertar nada. */
  dryRun?: boolean
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

async function syncFamily(
  tx: Tx,
  family: { id: string; canonicalName: string },
  dryRun: boolean,
): Promise<ClothingFamilySyncResult | null> {
  const variants = await tx.query.products.findMany({
    where: (p, { eq }) => eq(p.familyId, family.id),
    with: {
      productAttributes: { orderBy: (a, { asc }) => [asc(a.sortOrder)] },
      productSuppliers: { orderBy: (ps, { desc }) => [desc(ps.isPreferred)] },
    },
  })

  // Busca la variante que **declara** la familia `ropa` para usarla de
  // plantilla y para saber qué tallas ya existen.
  //
  // El criterio era «el atributo se llama Talla», y eso alcanzaba a todo el
  // catálogo importado: `product_attributes.size_family` es NULL en las 230
  // filas y el importador nombraba `Talla` a cualquier eje, así que botines
  // `N41`, guantes `N-9` y una capa `Única` entraban por igual — 33 familias
  // y 158 variantes XS..2XL inventadas, medido sobre bodega_dev. Exigir la
  // familia declarada deja el backfill inerte hasta que el dato diga a qué
  // escala pertenece, que es justo lo que el importador ya empezó a escribir.
  let sizeAttrName: string | null = null
  let templateVariant: (typeof variants)[number] | null = null
  const existingLabels = new Set<string>()
  for (const variant of variants) {
    const size = resolveProductSize(variant.productAttributes)
    if (!size || size.sizeFamily !== CLOTHING_SIZE_FAMILY) continue
    sizeAttrName ??= size.attributeName
    templateVariant ??= variant
    existingLabels.add(normalizeSizeLabel(size.label))
  }

  if (!sizeAttrName || !templateVariant) return null

  // Una familia sizada por números —un pantalón por cintura 42— también lleva el
  // atributo genérico `Talla`, así que el nombre solo no alcanza: sin este
  // guard el backfill le inventaría seis variantes XS..2XL, que es el mismo
  // daño que causaba tomar un guante `Talla: T/L` por ropa.
  //
  // El criterio es «alguna etiqueta no es numérica» y no «alguna está en
  // CLOTHING_TARGET_SIZES», para no excluir una familia de ropa que hoy sólo
  // tenga tallas fuera de esa lista (3XL, 4XL).
  const usesLetterScale = [...existingLabels].some((label) => !/^\d+(\.\d+)?$/.test(label))
  if (!usesLetterScale) return null

  const missingSizes = CLOTHING_TARGET_SIZES.filter((size) => !existingLabels.has(normalizeSizeLabel(size)))
  if (missingSizes.length === 0) {
    return { familyId: family.id, familyName: family.canonicalName, status: "already_complete", createdSizes: [] }
  }

  if (dryRun) {
    return { familyId: family.id, familyName: family.canonicalName, status: "created", createdSizes: [...missingSizes] }
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
 * Idempotente: sólo toca familias que **declaran** `size_family = 'ropa'` en su
 * atributo de talla, y volver a correrlo no duplica variantes.
 *
 * Con `dryRun` informa exactamente lo que crearía sin escribir: este backfill
 * inventa variantes de catálogo con SKU y proveedor propios, así que conviene
 * leer el resumen antes de dejarlo escribir.
 */
export async function addMissingClothingSizeVariants(
  options: ClothingSizeSyncOptions = {},
): Promise<ClothingSizeSyncSummary> {
  const dryRun = options.dryRun ?? false
  const families = await db.query.eppProductFamilies.findMany()

  const results: ClothingFamilySyncResult[] = []
  for (const family of families) {
    const result = await db.transaction((tx) => syncFamily(tx, family, dryRun))
    if (result) results.push(result)
  }

  return {
    familiesScanned: families.length,
    variantsCreated: results.reduce((sum, r) => sum + r.createdSizes.length, 0),
    dryRun,
    results,
  }
}

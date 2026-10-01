/**
 * Alta de una variante de talla clonada de otra de la misma familia.
 *
 * Lo comparten los backfills que completan el rango de tallas de una familia
 * (ropa en `epp-clothing-sizes`, calzado en `epp-size-ranges`): una talla que
 * nunca se compró no tiene otra fuente para marca, modelo, color, unidad, flags
 * ni proveedor preferente que una variante hermana que sí existe.
 */
import { sql } from "drizzle-orm"
import type { Tx } from "@/db"
import { products, productAttributes, productSuppliers } from "@/db/schema"
import { nanoid } from "@/lib/id"

/** Siguiente SKU secuencial `EPP-NNN` visto desde dentro de la transacción. */
export async function nextEppSku(tx: Tx): Promise<string> {
  const rows = await tx.select({ sku: products.sku }).from(products).where(sql`${products.sku} LIKE 'EPP-%'`)
  let max = 0
  for (const row of rows) {
    const num = parseInt(row.sku.slice(4), 10)
    if (!Number.isNaN(num) && num > max) max = num
  }
  return `EPP-${String(max + 1).padStart(3, "0")}`
}

type ProductRow = typeof products.$inferSelect
type AttributeRow = typeof productAttributes.$inferSelect
type SupplierRow = typeof productSuppliers.$inferSelect

export interface SizeVariantTemplate extends ProductRow {
  productAttributes: AttributeRow[]
  productSuppliers: SupplierRow[]
}

/**
 * Inserta la variante `size` copiando todo lo demás de `template`. El atributo
 * de talla se reescribe como select de un único valor —que es lo que hace de
 * una fila de `products` una variante— y conserva el nombre y el orden del
 * atributo de la plantilla. Devuelve el `id` del producto nuevo.
 */
export async function insertSizeVariantFromTemplate(
  tx: Tx,
  input: {
    template: SizeVariantTemplate
    templateSizeAttr: AttributeRow
    size: string
    /** `size_family` del atributo nuevo. */
    sizeFamily: string | null
    /** Sólo se fuerza cuando el backfill decide la vigencia (`isActive` de la plantilla si no). */
    isActive?: boolean
  },
): Promise<string> {
  const { template, templateSizeAttr, size, sizeFamily } = input
  const sku = await nextEppSku(tx)
  const productId = nanoid()

  await tx.insert(products).values({
    id: productId,
    sku,
    name: template.name,
    description: template.description,
    categoryId: template.categoryId,
    familyId: template.familyId,
    unitOfMeasure: template.unitOfMeasure,
    isEpp: template.isEpp,
    requiresPrevencion: template.requiresPrevencion,
    isService: template.isService,
    requiresWorker: template.requiresWorker,
    equipmentKind: template.equipmentKind,
    referencePrice: template.referencePrice,
    isActive: input.isActive ?? template.isActive,
    notes: template.notes,
  })

  const otherAttrs = template.productAttributes.filter((attr) => attr.id !== templateSizeAttr.id)
  if (otherAttrs.length > 0) {
    await tx.insert(productAttributes).values(otherAttrs.map((attr) => ({
      id: nanoid(), productId, categoryId: null,
      name: attr.name, type: attr.type, isRequired: attr.isRequired,
      options: attr.options, sizeFamily: attr.sizeFamily,
      drivesQuantity: attr.drivesQuantity, sortOrder: attr.sortOrder,
    })))
  }

  await tx.insert(productAttributes).values({
    id: nanoid(), productId, categoryId: null,
    name: templateSizeAttr.name, type: "select", isRequired: true,
    options: JSON.stringify([size]),
    sizeFamily,
    drivesQuantity: false,
    sortOrder: templateSizeAttr.sortOrder,
  })

  const preferredSupplier = template.productSuppliers.find((ps) => ps.isPreferred) ?? template.productSuppliers[0] ?? null
  if (preferredSupplier) {
    await tx.insert(productSuppliers).values({
      id: nanoid(), productId, supplierId: preferredSupplier.supplierId,
      unitPrice: preferredSupplier.unitPrice, isPreferred: true, notes: preferredSupplier.notes,
    })
  }

  return productId
}

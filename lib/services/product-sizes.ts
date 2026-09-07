import { inArray } from "drizzle-orm"
import { db, type DB } from "@/db"
import { productAttributes, requestItemAttributes } from "@/db/schema"
import { resolveProductSize, type ProductSize } from "@/lib/products/product-size"
import type { VariantAttribute, ResolvedVariantAttribute } from "@/lib/products/variant-grouping"

/**
 * Cualquier ejecutor que sepa `select`: la conexión, una transacción, o el
 * lector acotado que usa el preflight de stock EPP.
 */
type SizeReader = Pick<DB, "select">

/** Snapshot of requested values, including legacy products with multiple options. */
export async function getRequestItemAttributesByIds(ids: readonly string[], executor: SizeReader = db) {
  const result = new Map<string, ResolvedVariantAttribute[]>()
  if (!ids.length) return result
  const rows = await executor.select({
    itemId: requestItemAttributes.requestItemId,
    name: requestItemAttributes.attributeName,
    value: requestItemAttributes.value,
  }).from(requestItemAttributes).where(inArray(requestItemAttributes.requestItemId, [...new Set(ids)]))
  for (const row of rows) {
    const bucket = result.get(row.itemId) ?? []
    bucket.push({ name: row.name, value: row.value })
    result.set(row.itemId, bucket)
  }
  return result
}

/**
 * Talla de un conjunto de variantes, en una sola consulta.
 *
 * La talla vive en `product_attributes` de cada variante. Toda pantalla que
 * liste productos de catálogo la necesita —el catálogo importado guarda el
 * mismo `products.name` en todas las tallas de una familia, así que sin esto la
 * pantalla muestra filas idénticas con saldos distintos— y ninguna debe
 * resolverla por su cuenta: la regla de qué es una talla vive en
 * `lib/products/product-size`.
 *
 * Una consulta por pantalla y no una por fila: el índice
 * `product_attributes_product_id_idx` (migración 0251) es el que la sostiene.
 */
export async function getProductSizesByIds(
  productIds: readonly string[],
  /** Ejecutor alternativo: las guías de despacho leen dentro de su transacción. */
  executor: SizeReader = db,
): Promise<Map<string, ProductSize>> {
  const byProduct = await getProductAttributesByIds(productIds, executor)
  const sizes = new Map<string, ProductSize>()
  for (const [productId, attributes] of byProduct) {
    const size = resolveProductSize(attributes)
    if (size) sizes.set(productId, size)
  }
  return sizes
}

/** All variant axes, with a single query for each list or document. */
export async function getProductAttributesByIds(
  productIds: readonly string[],
  executor: SizeReader = db,
): Promise<Map<string, VariantAttribute[]>> {
  const unique = [...new Set(productIds.filter(Boolean))]
  if (unique.length === 0) return new Map()

  const rows = await executor
    .select({
      productId:  productAttributes.productId,
      name:       productAttributes.name,
      type:       productAttributes.type,
      options:    productAttributes.options,
      sizeFamily: productAttributes.sizeFamily,
      sortOrder:  productAttributes.sortOrder,
    })
    .from(productAttributes)
    .where(inArray(productAttributes.productId, unique))

  // El orden decide cuál gana si un producto declarara dos atributos de talla.
  // Se ordena acá y no en SQL: es una lista corta y así el resolvedor no exige
  // nada del ejecutor más allá de `select`.
  const byProduct = new Map<string, typeof rows>()
  for (const row of [...rows].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))) {
    if (!row.productId) continue
    const bucket = byProduct.get(row.productId)
    if (bucket) bucket.push(row)
    else byProduct.set(row.productId, [row])
  }

  return byProduct
}

/**
 * Catalogar al comprar (fase 2 del catálogo de repuestos, 2026-11-09): lo que el
 * formulario de «Nueva OC» necesita saber de un repuesto para vincularlo a una
 * línea —identidad y precio por proveedor—.
 *
 * Sin autorización: quien lo llama exige `purchasing:create_order`. El vínculo
 * se escribe recién al crear la OC (`purchase-orders-create.ts`), que vuelve a
 * validar el repuesto bajo bloqueo; esto sólo alimenta la pantalla.
 */

import { and, eq, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { productSuppliers, products } from "@/db/schema"

export interface SparePartLinkInfo {
  id: string
  sku: string
  name: string
  partNumber: string | null
  partBrand: string | null
  unitOfMeasure: string
  /** Precio unitario del catálogo por proveedor (`supplierId` → precio). Sólo los conocidos. */
  prices: Record<string, number>
}

/** Un repuesto ACTIVO del catálogo con sus precios por proveedor; `null` si no existe o no es repuesto. */
export async function getSparePartLinkInfo(productId: string): Promise<SparePartLinkInfo | null> {
  if (!productId) return null
  const [part] = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      partNumber: products.partNumber,
      partBrand: products.partBrand,
      unitOfMeasure: products.unitOfMeasure,
    })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.isSparePart, true), eq(products.isActive, true)))
  if (!part) return null

  const priceRows = await db
    .select({ supplierId: productSuppliers.supplierId, unitPrice: productSuppliers.unitPrice })
    .from(productSuppliers)
    .where(and(eq(productSuppliers.productId, productId), isNotNull(productSuppliers.unitPrice)))

  const prices: Record<string, number> = {}
  for (const row of priceRows) {
    if (row.unitPrice !== null) prices[row.supplierId] = row.unitPrice
  }
  return { ...part, prices }
}

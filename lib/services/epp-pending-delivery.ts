import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries,
  deliveryItems,
  products,
  purchaseOrderItems,
  purchaseRequestItems,
  purchaseRequests,
  worksiteStock,
} from "@/db/schema"
import { getTraceableDeliveryBalance } from "@/lib/services/delivery-eligibility"
import type { DeliverableEppOption, DeliverableEppScope } from "./epp-pending-delivery.types"

export type { DeliverableEppOption, DeliverableEppScope } from "./epp-pending-delivery.types"

/**
 * EPP "por entregar": ítems de solicitud recibidos (parcial o totalmente) en
 * faena a los que aún les queda saldo trazable por entregar y que tienen stock
 * físico > 0 en la bodega de la solicitud.
 *
 * Es la fuente única del cálculo que antes vivía en línea en `/entregas`; la
 * pantalla de Entregas, el formulario y los indicadores de Bodega leen de aquí
 * para que "pendiente de entregar" signifique lo mismo en todas partes.
 *
 * El saldo entregado excluye entregas anuladas (una anulación repone el saldo).
 */
export async function getDeliverableEppItems(scope: DeliverableEppScope): Promise<DeliverableEppOption[]> {
  if (scope.worksiteIds !== "all" && scope.worksiteIds.length === 0) return []

  const receivedItems = await db
    .select({
      id: purchaseRequestItems.id,
      productId: purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      quantity: purchaseRequestItems.quantity,
      unitOfMeasure: purchaseRequestItems.unitOfMeasure,
      requestCode: purchaseRequests.code,
      requestWorksiteId: purchaseRequests.worksiteId,
      productName: products.name,
      productSku: products.sku,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .innerJoin(products, eq(purchaseRequestItems.productId, products.id))
    .where(and(
      inArray(purchaseRequestItems.status, ["partially_received", "partially_delivered"]),
      isNotNull(purchaseRequestItems.productId),
      eq(products.isEpp, true),
      scope.worksiteIds === "all" ? undefined : inArray(purchaseRequests.worksiteId, scope.worksiteIds),
    ))
  if (receivedItems.length === 0) return []

  const itemIds = receivedItems.map((item) => item.id)
  const productIds = [...new Set(receivedItems.flatMap((item) => (item.productId ? [item.productId] : [])))]
  const worksiteIds = [...new Set(receivedItems.map((item) => item.requestWorksiteId))]

  const [deliveredRows, faenaReceiptRows, stockRows] = await Promise.all([
    db
      .select({
        requestItemId: deliveryItems.requestItemId,
        quantity: sql<number>`coalesce(sum(${deliveryItems.quantity}), 0)`,
      })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
      .where(and(inArray(deliveryItems.requestItemId, itemIds), isNull(deliveries.voidedAt)))
      .groupBy(deliveryItems.requestItemId),
    db
      .select({
        requestItemId: purchaseOrderItems.requestItemId,
        receivedAtFaena: sql<number>`coalesce(sum(${purchaseOrderItems.quantityReceived}), 0)`,
      })
      .from(purchaseOrderItems)
      .where(inArray(purchaseOrderItems.requestItemId, itemIds))
      .groupBy(purchaseOrderItems.requestItemId),
    db
      .select({
        worksiteId: worksiteStock.worksiteId,
        productId: worksiteStock.productId,
        quantity: worksiteStock.quantity,
      })
      .from(worksiteStock)
      .where(and(
        inArray(worksiteStock.worksiteId, worksiteIds),
        inArray(worksiteStock.productId, productIds),
        gt(worksiteStock.quantity, 0),
      )),
  ])

  const deliveredByItem = new Map<string, number>()
  for (const row of deliveredRows) {
    if (!row.requestItemId) continue
    deliveredByItem.set(row.requestItemId, Number(row.quantity ?? 0))
  }
  const receivedAtFaenaByItem = new Map<string, number>()
  for (const row of faenaReceiptRows) {
    if (!row.requestItemId) continue
    receivedAtFaenaByItem.set(row.requestItemId, Number(row.receivedAtFaena ?? 0))
  }
  const stockByWorksiteProduct = new Map<string, number>()
  for (const row of stockRows) {
    stockByWorksiteProduct.set(`${row.worksiteId}:${row.productId}`, row.quantity)
  }

  return receivedItems
    .map((item): DeliverableEppOption => {
      const deliveredQuantity = deliveredByItem.get(item.id) ?? 0
      const receivedAtFaena = receivedAtFaenaByItem.get(item.id) ?? 0
      return {
        requestItemId: item.id,
        requestCode: item.requestCode,
        worksiteId: item.requestWorksiteId,
        productId: item.productId!,
        productName: item.productName ?? item.productNameFree ?? "EPP recibido",
        productSku: item.productSku,
        quantity: item.quantity,
        deliveredQuantity,
        receivedAtFaena,
        remainingQuantity: getTraceableDeliveryBalance({
          requestedQuantity: item.quantity,
          receivedAtFaena,
          deliveredQuantity,
        }),
        stockQuantity: stockByWorksiteProduct.get(`${item.requestWorksiteId}:${item.productId}`) ?? 0,
        unitOfMeasure: item.unitOfMeasure,
      }
    })
    .filter((item) => item.remainingQuantity > 0 && item.stockQuantity > 0)
}

/** Cuántos ítems EPP hay por entregar en el alcance (para cabeceras e indicadores). */
export async function countDeliverableEppItems(scope: DeliverableEppScope): Promise<number> {
  return (await getDeliverableEppItems(scope)).length
}

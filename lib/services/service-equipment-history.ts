/**
 * Historial de un instrumento del registro: qué mantenciones y calibraciones
 * se le han pedido, en qué estado están y cuánto costaron.
 *
 * Es la razón de ser del registro. Mientras el equipo se re-escribía a mano en
 * cada solicitud no había forma de responder "cuándo se calibró por última vez
 * este alcotest", que es justo lo que pregunta una fiscalización.
 */

import { and, desc, eq, ne } from "drizzle-orm"
import { db } from "@/db"
import {
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  users,
} from "@/db/schema"

export interface EquipmentServiceRecord {
  requestItemId:  string
  requestId:      string
  requestCode:    string
  serviceName:    string
  itemStatus:     string
  requiredDate:   string | null
  requestedAt:    string
  requesterName:  string | null
  orderId:        string | null
  orderCode:      string | null
  orderStatus:    string | null
  /** `null` = costo pendiente; sin OC todavía también es `null`. */
  unitPrice:      number | null
  subtotal:       number | null
  costRecordedAt: string | null
}

export async function getEquipmentServiceHistory(
  equipmentId: string,
  limit = 50,
): Promise<EquipmentServiceRecord[]> {
  const rows = await db
    .select({
      requestItemId: purchaseRequestItems.id,
      requestId:     purchaseRequests.id,
      requestCode:   purchaseRequests.code,
      productName:   products.name,
      productFree:   purchaseRequestItems.productNameFree,
      itemStatus:    purchaseRequestItems.status,
      requiredDate:  purchaseRequestItems.requiredDate,
      requestedAt:   purchaseRequestItems.createdAt,
      requesterName: users.name,
      orderId:       purchaseOrders.id,
      orderCode:     purchaseOrders.code,
      orderStatus:   purchaseOrders.status,
      unitPrice:     purchaseOrderItems.unitPrice,
      subtotal:      purchaseOrderItems.subtotal,
      costRecordedAt: purchaseOrderItems.costRecordedAt,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
    .leftJoin(users, eq(purchaseRequests.requesterId, users.id))
    // La OC anulada no cuenta como intervención del equipo; una OC eliminada
    // (soft delete) tampoco, y por eso se filtra `deletedAt`.
    .leftJoin(purchaseOrderItems, and(
      eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id),
      ne(purchaseOrderItems.status, "cancelled"),
    ))
    .leftJoin(purchaseOrders, and(
      eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id),
      ne(purchaseOrders.status, "cancelled"),
    ))
    .where(eq(purchaseRequestItems.equipmentId, equipmentId))
    .orderBy(desc(purchaseRequestItems.createdAt))
    .limit(limit)

  return rows.map((row) => ({
    requestItemId:  row.requestItemId,
    requestId:      row.requestId,
    requestCode:    row.requestCode,
    serviceName:    row.productName ?? row.productFree ?? "Servicio",
    itemStatus:     row.itemStatus,
    requiredDate:   row.requiredDate,
    requestedAt:    row.requestedAt,
    requesterName:  row.requesterName,
    orderId:        row.orderId,
    orderCode:      row.orderCode,
    orderStatus:    row.orderStatus,
    unitPrice:      row.unitPrice,
    subtotal:       row.subtotal,
    costRecordedAt: row.costRecordedAt,
  }))
}

/**
 * Compras vinculadas a un vehículo de la flota: las solicitudes de repuestos y
 * de servicios que apuntan a él (`purchase_request_items.vehicle_id`), con su OC
 * y su costo. Alimenta la ficha del equipo (mantención) y la del vehículo (flota).
 *
 * Mismo modelo que `getEquipmentServiceHistory` (instrumentos de servicio), con
 * dos diferencias: la OC eliminada (`deleted_at`) tampoco cuenta, y trae el folio
 * de la OT para la que se pidió.
 *
 * NO aplica alcance de permisos: lo llaman las fichas DESPUÉS de resolver el
 * equipo con el alcance de faenas de quien mira, y exigen `purchasing:view` (o
 * `repuestos:view_all` en la ficha de mantención) antes de pedirlo.
 */

import { and, desc, eq, isNull, ne } from "drizzle-orm"
import { db } from "@/db"
import {
  mantWorkOrders,
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  users,
} from "@/db/schema"
import { itemStatusLabel } from "@/lib/work-queue-labels"

export interface VehiclePurchaseRecord {
  requestItemId:   string
  requestId:       string
  requestCode:     string
  /** `repuestos` o `servicios`. */
  requestType:     string
  itemName:        string
  quantity:        number
  unitOfMeasure:   string
  itemStatus:      string
  /** Estado del ítem en español: nunca el valor crudo del enum. */
  itemStatusLabel: string
  workOrderId:     string | null
  workOrderFolio:  string | null
  requestedAt:     string
  requesterName:   string | null
  orderId:         string | null
  orderCode:       string | null
  orderStatus:     string | null
  /** `null` = sin OC todavía o costo pendiente. */
  unitPrice:       number | null
  subtotal:        number | null
}

export async function getVehiclePurchaseHistory(
  vehicleId: string,
  limit = 50,
): Promise<VehiclePurchaseRecord[]> {
  const rows = await db
    .select({
      requestItemId:  purchaseRequestItems.id,
      requestId:      purchaseRequests.id,
      requestCode:    purchaseRequests.code,
      requestType:    purchaseRequests.requestType,
      productName:    products.name,
      productFree:    purchaseRequestItems.productNameFree,
      quantity:       purchaseRequestItems.quantity,
      unitOfMeasure:  purchaseRequestItems.unitOfMeasure,
      itemStatus:     purchaseRequestItems.status,
      workOrderId:    purchaseRequestItems.workOrderId,
      workOrderFolio: mantWorkOrders.folio,
      requestedAt:    purchaseRequestItems.createdAt,
      requesterName:  users.name,
      orderId:        purchaseOrders.id,
      orderCode:      purchaseOrders.code,
      orderStatus:    purchaseOrders.status,
      unitPrice:      purchaseOrderItems.unitPrice,
      subtotal:       purchaseOrderItems.subtotal,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
    .leftJoin(users, eq(purchaseRequests.requesterId, users.id))
    .leftJoin(mantWorkOrders, eq(purchaseRequestItems.workOrderId, mantWorkOrders.id))
    // Una línea anulada no es una compra; una OC anulada o eliminada (soft
    // delete) tampoco, y la línea queda «sin OC» como si nunca se hubiera emitido.
    .leftJoin(purchaseOrderItems, and(
      eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id),
      ne(purchaseOrderItems.status, "cancelled"),
    ))
    .leftJoin(purchaseOrders, and(
      eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id),
      ne(purchaseOrders.status, "cancelled"),
      isNull(purchaseOrders.deletedAt),
    ))
    .where(eq(purchaseRequestItems.vehicleId, vehicleId))
    .orderBy(desc(purchaseRequestItems.createdAt), desc(purchaseRequestItems.id))
    .limit(limit)

  return rows.map((row) => {
    // El precio vive en la línea de OC, pero si la OC no cuenta (anulada o eliminada) el
    // costo tampoco: sin esto la fila diría «Sin OC» y a la vez un subtotal.
    const hasOrder = row.orderId !== null
    return {
      requestItemId:   row.requestItemId,
      requestId:       row.requestId,
      requestCode:     row.requestCode,
      requestType:     row.requestType,
      itemName:        row.productName ?? row.productFree ?? (row.requestType === "servicios" ? "Servicio" : "Repuesto"),
      quantity:        row.quantity,
      unitOfMeasure:   row.unitOfMeasure,
      itemStatus:      row.itemStatus,
      itemStatusLabel: itemStatusLabel(row.itemStatus),
      workOrderId:     row.workOrderId,
      workOrderFolio:  row.workOrderFolio,
      requestedAt:     row.requestedAt,
      requesterName:   row.requesterName,
      orderId:         row.orderId,
      orderCode:       row.orderCode,
      orderStatus:     row.orderStatus,
      unitPrice:       hasOrder ? row.unitPrice : null,
      subtotal:        hasOrder ? row.subtotal : null,
    }
  })
}

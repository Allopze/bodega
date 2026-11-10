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

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm"
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
  /**
   * Producto de catálogo de la línea: el del ítem de solicitud (también cuando
   * Compras lo catalogó al armar la OC, que lo escribe ahí y lo deshace si esa
   * OC se elimina o se anula) o, en su defecto, el de una línea de OC viva.
   * `null` = texto libre. La ficha del repuesto sólo existe cuando `isSparePart`.
   */
  productId:       string | null
  sku:             string | null
  /** N° de parte del fabricante (repuestos de catálogo). */
  partNumber:      string | null
  isSparePart:     boolean
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
      productId:      products.id,
      productSku:     products.sku,
      productPartNumber:  products.partNumber,
      productIsSparePart: products.isSparePart,
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
    // El producto va después de la OC porque puede venir de ella. Catalogar al
    // armar la OC escribe el `product_id` en el ítem de solicitud y lo devuelve a
    // texto libre si esa OC se elimina o se anula (`spare-part-link-revert.ts`),
    // así que el del ítem manda; el de la línea de OC sólo suple a un ítem sin
    // producto, y el de una OC que no cuenta (anulada o eliminada) no cuenta.
    .leftJoin(products, eq(products.id, sql`coalesce(
      ${purchaseRequestItems.productId},
      case when ${purchaseOrders.id} is not null then ${purchaseOrderItems.productId} end
    )`))
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
      productId:       row.productId,
      sku:             row.productSku,
      partNumber:      row.productPartNumber,
      isSparePart:     row.productIsSparePart === true,
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

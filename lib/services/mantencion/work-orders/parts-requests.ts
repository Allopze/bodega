import { and, asc, desc, eq, isNull, ne, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db } from "@/db"
import { products, purchaseOrderItems, purchaseOrders, purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { OT_OPEN_STATUSES, type OtStatus } from "@/lib/mantencion/work-order-states"
import { itemStatusLabel } from "@/lib/work-queue-labels"
import type { WorkOrderPartsRequest } from "./types"

/**
 * «Repuestos pedidos» de una OT: las solicitudes de compra cuyos ítems apuntan a
 * ella (`purchase_request_items.work_order_id`), con su OC activa y lo que ya
 * llegó a faena. La OT NO lleva repuestos en su documento (decisión 8 del plan
 * «Repuestos vinculados al equipo y a la OT»): esto sólo lee lo que las
 * solicitudes y las compras ya guardaron, para mostrarlo como información y para
 * decir si la OT está esperando un repuesto.
 *
 * Sin alcance de permisos de solicitudes, a propósito. Lo llama
 * `loadWorkOrderDetail` DESPUÉS de `canSeeWorkOrder`: ver la OT incluye ver lo que
 * se pidió para ella, la misma regla de `linked-work.ts` con el trabajo enlazado.
 * Quien consulte esta lectura por otro camino tiene que haber comprobado antes
 * que el usuario ve ESA OT. El enlace a la solicitud sí lo decide la pantalla con
 * `repuestos:view_all`.
 */

/**
 * Estados de ítem en que el repuesto ya se pidió y todavía no llegó a faena: del
 * envío a aprobación a la recepción parcial. `received` en adelante ya está (o se
 * entregó), y `rejected` nunca va a llegar. `partially_received` espera el resto.
 *
 * El borrador (`draft`) NO cuenta (decisión 2026-11-07): todavía no es un pedido,
 * y un borrador olvidado dejaba la OT «esperando repuesto» para siempre. La
 * sección de la OT lo sigue listando como «Borrador».
 */
export const PARTS_PENDING_ITEM_STATUSES = [
  "requested", "approved", "pending_purchase", "in_purchase_order", "purchased",
  "partially_office_received", "office_received", "partially_received",
] as const

/**
 * Solicitudes que ya no van a traer nada. Cancelar deja los ítems `rejected`, así
 * que el estado del ítem ya las excluye; esto cubre una solicitud rechazada o
 * cancelada cuyo ítem quedara en otro estado, para que nunca sostengan una espera.
 */
const DEAD_REQUEST_STATUSES = ["cancelled", "rejected"] as const

const list = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `)

/**
 * `EXISTS` sobre los ítems de solicitud de esa OT que siguen pendientes. Única
 * fuente de «esperando repuesto» para la lista, el panel y el tile de Control
 * operacional. NO mira el estado de la OT: quien lo usa lo combina con «abierta»
 * (una OT cerrada ya soltó el equipo y no espera nada).
 *
 * `workOrderId` es la columna (o expresión) de la consulta que lo rodea: la lista
 * y las cifras pasan `mantWorkOrders.id`.
 */
export function partsPendingExistsSql(workOrderId: AnyPgColumn | SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${purchaseRequestItems}
    INNER JOIN ${purchaseRequests} ON ${purchaseRequests.id} = ${purchaseRequestItems.requestId}
    WHERE ${purchaseRequestItems.workOrderId} = ${workOrderId}
      AND ${purchaseRequestItems.status} IN (${list(PARTS_PENDING_ITEM_STATUSES)})
      AND ${purchaseRequests.status} NOT IN (${list(DEAD_REQUEST_STATUSES)})
  )`
}

/**
 * La misma regla que `partsPendingExistsSql`, sobre las filas ya leídas: la OT
 * está abierta y alguna línea pedida sigue sin llegar. Una OT cerrada o anulada
 * no espera repuesto aunque tenga líneas sin recibir (el equipo ya salió).
 */
export function isWaitingParts(
  status: OtStatus,
  rows: ReadonlyArray<Pick<WorkOrderPartsRequest, "itemStatus" | "requestStatus">>,
): boolean {
  if (!(OT_OPEN_STATUSES as readonly string[]).includes(status)) return false
  return rows.some((row) =>
    (PARTS_PENDING_ITEM_STATUSES as readonly string[]).includes(row.itemStatus)
    && !(DEAD_REQUEST_STATUSES as readonly string[]).includes(row.requestStatus))
}

const iso = (value: string) => new Date(value).toISOString()

/**
 * Las líneas pedidas para la OT, la solicitud más reciente primero. La OC es la
 * activa de la línea: una línea de OC anulada, o una OC anulada o eliminada
 * (`deleted_at`), deja la línea sin OC y con 0 recibido, porque lo recibido de una
 * compra que ya no existe no es un repuesto que haya llegado.
 */
export async function loadWorkOrderPartsRequests(workOrderId: string): Promise<WorkOrderPartsRequest[]> {
  const rows = await db
    .select({
      requestId: purchaseRequests.id,
      requestCode: purchaseRequests.code,
      requestStatus: purchaseRequests.status,
      requestedAt: purchaseRequests.createdAt,
      itemId: purchaseRequestItems.id,
      freeName: purchaseRequestItems.productNameFree,
      productId: products.id,
      productSku: products.sku,
      productPartNumber: products.partNumber,
      productIsSparePart: products.isSparePart,
      productName: products.name,
      quantity: purchaseRequestItems.quantity,
      unitOfMeasure: purchaseRequestItems.unitOfMeasure,
      itemStatus: purchaseRequestItems.status,
      orderId: purchaseOrders.id,
      orderCode: purchaseOrders.code,
      orderStatus: purchaseOrders.status,
      estimatedDelivery: purchaseOrders.estimatedDelivery,
      quantityReceived: sql<number>`CASE WHEN ${purchaseOrders.id} IS NULL THEN 0 ELSE COALESCE(${purchaseOrderItems.quantityReceived}, 0) END`,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
    .leftJoin(purchaseOrderItems, and(eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id), ne(purchaseOrderItems.status, "cancelled")))
    .leftJoin(purchaseOrders, and(eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId), ne(purchaseOrders.status, "cancelled"), isNull(purchaseOrders.deletedAt)))
    // El producto es el del ítem de solicitud o, si era texto libre y Compras lo
    // catalogó al armar la OC, el de la línea de OC (siempre que esa OC cuente).
    .leftJoin(products, eq(products.id, sql`coalesce(
      ${purchaseRequestItems.productId},
      case when ${purchaseOrders.id} is not null then ${purchaseOrderItems.productId} end
    )`))
    .where(eq(purchaseRequestItems.workOrderId, workOrderId))
    .orderBy(desc(purchaseRequests.createdAt), asc(purchaseRequestItems.sortOrder), asc(purchaseRequestItems.id))

  // Un ítem tiene a lo sumo una línea de OC viva; si un dato raro trae dos, la fila no se duplica.
  const seen = new Set<string>()
  const lines: WorkOrderPartsRequest[] = []
  for (const row of rows) {
    if (seen.has(row.itemId)) continue
    seen.add(row.itemId)
    lines.push({
      requestId: row.requestId,
      requestCode: row.requestCode,
      requestStatus: row.requestStatus,
      itemId: row.itemId,
      description: row.freeName?.trim() || row.productName || "Sin descripción",
      productId: row.productId,
      sku: row.productSku,
      partNumber: row.productPartNumber,
      isSparePart: row.productIsSparePart === true,
      quantity: row.quantity,
      unitOfMeasure: row.unitOfMeasure,
      itemStatus: row.itemStatus,
      itemStatusLabel: itemStatusLabel(row.itemStatus),
      orderId: row.orderId,
      orderCode: row.orderCode,
      orderStatus: row.orderStatus,
      estimatedDelivery: row.orderId ? row.estimatedDelivery : null,
      quantityReceived: Number(row.quantityReceived),
      requestedAt: iso(row.requestedAt),
    })
  }
  return lines
}

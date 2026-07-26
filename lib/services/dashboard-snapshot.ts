/**
 * Dashboard work-queue snapshot.
 * Provides a lightweight view of active requests, items, and orders.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  suppliers,
  worksiteStock,
  worksites,
} from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import type { Session } from "next-auth"
import type {
  WorkQueueSnapshot,
  WorkRequestRow,
  WorkItemRow,
  WorkOrderRow,
} from "@/lib/work-queue"

// ── Snapshot query constants ──────────────────────────────────────────────────

const ACTIVE_REQUEST_STATUSES_SNAPSHOT = [
  "draft", "submitted", "in_review", "partially_approved",
  "approved", "returned", "in_purchasing",
]
const ACTIVE_ITEM_STATUSES_SNAPSHOT = [
  "requested", "approved", "pending_purchase",
  "received", "partially_delivered",
]
const ACTIVE_ORDER_STATUSES_SNAPSHOT = [
  "draft", "issued", "sent", "supplier_confirmed",
  "partially_office_received", "office_received", "partially_received",
]
const SNAPSHOT_LIMIT = 200
// La cola transversal usa este límite sólo en servidor. Se mantiene acotado
// para proteger las consultas, pero evita truncar una operación mediana antes
// de aplicar filtros, prioridad y cursor global.
const MAX_QUEUE_SOURCE_LIMIT = 5000

/**
 * Carga acotada de entidades activas para los consumidores operacionales.
 * El dashboard conserva su lectura liviana por defecto; la cola transversal
 * pide un límite mayor y pagina sólo después de aplicar permisos y prioridad
 * en servidor.
 */
export async function getWorkQueueSnapshot(session: Session, requestedLimit = SNAPSHOT_LIMIT): Promise<WorkQueueSnapshot> {
  const sourceLimit = Math.max(1, Math.min(requestedLimit, MAX_QUEUE_SOURCE_LIMIT))
  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const requestWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`)
  const itemWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`)
  const orderWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`false`)

  const [
    requestRows,
    itemRows,
    orderRows,
  ] = await Promise.all([
    db
      .select({
        id:           purchaseRequests.id,
        code:         purchaseRequests.code,
        worksiteId:   purchaseRequests.worksiteId,
        worksiteName: worksites.name,
        requesterId:  purchaseRequests.requesterId,
        status:       purchaseRequests.status,
        urgency:      purchaseRequests.urgency,
        requiredDate: purchaseRequests.requiredDate,
        itemCount:    sql<number>`(SELECT COUNT(*)::int FROM ${purchaseRequestItems} WHERE ${purchaseRequestItems.requestId} = ${purchaseRequests.id})`,
        createdAt:    purchaseRequests.createdAt,
        submittedAt:  purchaseRequests.submittedAt,
      })
      .from(purchaseRequests)
      .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
      .where(and(
        requestWorksiteFilter,
        inArray(purchaseRequests.status, ACTIVE_REQUEST_STATUSES_SNAPSHOT),
      ))
      // Si una fuente supera el límite defensivo, conservamos primero lo que
      // requiere atención; no una porción arbitraria por fecha de creación.
      .orderBy(
        sql`CASE ${purchaseRequests.urgency} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`,
        asc(purchaseRequests.requiredDate),
        desc(purchaseRequests.createdAt),
      )
      .limit(sourceLimit),

    db
      .select({
        id:              purchaseRequestItems.id,
        requestId:       purchaseRequestItems.requestId,
        requestCode:     purchaseRequests.code,
        worksiteId:      purchaseRequests.worksiteId,
        worksiteName:    worksites.name,
        requesterId:     purchaseRequests.requesterId,
        productName:     products.name,
        productNameFree: purchaseRequestItems.productNameFree,
        productId:       purchaseRequestItems.productId,
        status:          purchaseRequestItems.status,
        urgency:         purchaseRequestItems.urgency,
        requiredDate:    purchaseRequestItems.requiredDate,
        requestRequiredDate: purchaseRequests.requiredDate,
        createdAt:       purchaseRequestItems.createdAt,
        quantity:        purchaseRequestItems.quantity,
        unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
      .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
      .where(and(
        itemWorksiteFilter,
        inArray(purchaseRequestItems.status, ACTIVE_ITEM_STATUSES_SNAPSHOT),
      ))
      .orderBy(
        sql`CASE COALESCE(${purchaseRequestItems.urgency}, ${purchaseRequests.urgency}) WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`,
        asc(purchaseRequestItems.requiredDate),
        desc(purchaseRequestItems.createdAt),
      )
      .limit(sourceLimit),

    db
      .select({
        id:           purchaseOrders.id,
        code:         purchaseOrders.code,
        worksiteId:   purchaseOrders.worksiteId,
        worksiteName: worksites.name,
        supplierName: suppliers.name,
        status:       purchaseOrders.status,
        createdAt:    purchaseOrders.createdAt,
        issuedAt:     purchaseOrders.issuedAt,
        sentAt:       purchaseOrders.sentAt,
        totalAmount:  purchaseOrders.totalAmount,
        deliveryMode: purchaseOrders.deliveryMode,
        estimatedDelivery: purchaseOrders.estimatedDelivery,
      })
      .from(purchaseOrders)
      .innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(and(
        orderWorksiteFilter,
        inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES_SNAPSHOT),
      ))
      .orderBy(asc(purchaseOrders.estimatedDelivery), desc(purchaseOrders.createdAt))
      .limit(sourceLimit),

  ])

  // Cargamos sólo el stock necesario para los ítems operacionales que ya
  // pasaron el alcance de faena; consultar toda la bodega penalizaba la cola
  // incluso cuando el usuario sólo tenía unos pocos pendientes.
  const orderIds = orderRows.map((r) => r.id)
  const itemProductIds = [...new Set(itemRows.flatMap((item) => item.productId ? [item.productId] : []))]
  const itemWorksiteIds = [...new Set(itemRows.map((item) => item.worksiteId))]
  const [itemCountRows, stockRows] = await Promise.all([
    orderIds.length > 0
      ? db
          .select({
            orderId: purchaseOrderItems.purchaseOrderId,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(purchaseOrderItems)
          .where(inArray(purchaseOrderItems.purchaseOrderId, orderIds))
          .groupBy(purchaseOrderItems.purchaseOrderId)
      : Promise.resolve([]),
    itemProductIds.length > 0 && itemWorksiteIds.length > 0
      ? db
          .select({
            productId: worksiteStock.productId,
            worksiteId: worksiteStock.worksiteId,
          })
          .from(worksiteStock)
          .where(and(
            inArray(worksiteStock.productId, itemProductIds),
            inArray(worksiteStock.worksiteId, itemWorksiteIds),
            sql`${worksiteStock.quantity} > 0`,
          ))
      : Promise.resolve([]),
  ])
  const itemCountByOrder = new Map(itemCountRows.map((r) => [r.orderId, r.count]))

  const itemStatusesByRequest = new Map<string, string[]>()
  for (const item of itemRows) {
    const statuses = itemStatusesByRequest.get(item.requestId) ?? []
    statuses.push(item.status)
    itemStatusesByRequest.set(item.requestId, statuses)
  }

  const itemCountByRequest = new Map<string, number>()
  for (const item of itemRows) {
    itemCountByRequest.set(item.requestId, (itemCountByRequest.get(item.requestId) ?? 0) + 1)
  }

  // El stock habilita la entrega sólo en la misma faena del ítem. Un producto
  // disponible en otra faena no puede convertir esta etapa en entregable.
  const stockByWorksiteProduct = new Set(stockRows.map((row) => `${row.worksiteId}:${row.productId}`))

  const requests: WorkRequestRow[] = requestRows.map((request) => ({
    ...request,
    itemCount:    request.itemCount ?? itemCountByRequest.get(request.id) ?? 0,
    itemStatuses: itemStatusesByRequest.get(request.id) ?? [],
  }))

  const items: WorkItemRow[] = itemRows.map((item) => ({
    id:            item.id,
    requestId:     item.requestId,
    requestCode:   item.requestCode,
    worksiteId:    item.worksiteId,
    worksiteName:  item.worksiteName,
    requesterId:   item.requesterId,
    productName:   item.productName ?? item.productNameFree ?? "Ítem solicitado",
    status:        item.status,
    urgency:       item.urgency,
    requiredDate:  item.requiredDate ?? item.requestRequiredDate,
    createdAt:     item.createdAt,
    quantity:      item.quantity,
    unitOfMeasure: item.unitOfMeasure,
    hasStock:      item.productId ? stockByWorksiteProduct.has(`${item.worksiteId}:${item.productId}`) : false,
  }))

  const orders: WorkOrderRow[] = orderRows.map((order) => ({
    ...order,
    itemCount: itemCountByOrder.get(order.id) ?? 0,
  }))

  return { requests, items, orders }
}

/**
 * Dashboard work-queue snapshot.
 * Provides a lightweight view of active requests, items, and orders.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  products,
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

export async function getWorkQueueSnapshot(session: Session): Promise<WorkQueueSnapshot> {
  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const requestWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`)
  const itemWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`)
  const orderWorksiteFilter = isGlobal ? undefined : (wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`false`)

  const [
    requestRows,
    itemRows,
    orderRows,
    stockRows,
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
        createdAt:    purchaseRequests.createdAt,
        submittedAt:  purchaseRequests.submittedAt,
      })
      .from(purchaseRequests)
      .innerJoin(worksites, eq(purchaseRequests.worksiteId, worksites.id))
      .where(and(
        requestWorksiteFilter,
        inArray(purchaseRequests.status, ACTIVE_REQUEST_STATUSES_SNAPSHOT),
      ))
      .orderBy(desc(purchaseRequests.createdAt))
      .limit(SNAPSHOT_LIMIT),

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
      .limit(SNAPSHOT_LIMIT),

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
        itemCount:    sql<number>`(SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = ${purchaseOrders.id})`,
      })
      .from(purchaseOrders)
      .innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(and(
        orderWorksiteFilter,
        inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES_SNAPSHOT),
      ))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(SNAPSHOT_LIMIT),

    db
      .select({
        productId: worksiteStock.productId,
      })
      .from(worksiteStock)
      .where(sql`${worksiteStock.quantity} > 0`),
  ])

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

  const stockProductIds = new Set(stockRows.map((row) => row.productId))

  const requests: WorkRequestRow[] = requestRows.map((request) => ({
    ...request,
    itemCount:    itemCountByRequest.get(request.id) ?? 0,
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
    createdAt:     item.createdAt,
    quantity:      item.quantity,
    unitOfMeasure: item.unitOfMeasure,
    hasStock:      item.productId ? stockProductIds.has(item.productId) : false,
  }))

  const orders: WorkOrderRow[] = orderRows.map((order) => ({
    ...order,
    itemCount: order.itemCount,
  }))

  return { requests, items, orders }
}

import type { Session } from "next-auth"
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries,
  deliveryItems,
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  worksites,
  worksiteStock,
} from "@/db/schema"
import { TERMINAL_REQUEST_STATUSES } from "@/lib/approvals-queue"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { RECEIVABLE_ORDER_STATUSES } from "@/lib/work-queue"

export interface StockAvailabilityRow {
  worksiteId: string
  productId: string
  onHand: number
  pendingDemand: number
  incoming: number
  projectedBalance: number
}

export interface StockAvailabilityInput {
  onHand: number
  approvedDemand: number
  delivered: number
  ordered: number
  receivedAtFaena: number
}

export interface StockAvailabilityFilters {
  worksiteId?: string
}

const ACTIVE_DEMAND_ITEM_STATUSES = [
  "approved",
  "pending_purchase",
  "in_purchase_order",
  "purchased",
  "partially_office_received",
  "office_received",
  "partially_received",
  "partially_delivered",
] as const

export function computeStockAvailability({
  onHand,
  approvedDemand,
  delivered,
  ordered,
  receivedAtFaena,
}: StockAvailabilityInput): Pick<
  StockAvailabilityRow,
  "onHand" | "pendingDemand" | "incoming" | "projectedBalance"
> {
  const pendingDemand = Math.max(0, approvedDemand - delivered)
  const incoming = Math.max(0, ordered - receivedAtFaena)

  return {
    onHand,
    pendingDemand,
    incoming,
    projectedBalance: onHand - pendingDemand + incoming,
  }
}

interface AvailabilityAggregateRow {
  worksiteId: string
  productId: string
  quantity: number
}

interface IncomingAggregateRow {
  worksiteId: string
  productId: string | null
  ordered: number
  receivedAtFaena: number
}

function availabilityKey(worksiteId: string, productId: string): string {
  return `${worksiteId}\u0000${productId}`
}

function toQuantityMap(rows: AvailabilityAggregateRow[]): Map<string, number> {
  return new Map(rows.map((row) => [
    availabilityKey(row.worksiteId, row.productId),
    Number(row.quantity ?? 0),
  ]))
}

/**
 * Read-only stock projection by final worksite and concrete catalog product.
 * It informs replenishment decisions; mutations must keep enforcing their own
 * transactional stock and lifecycle guards.
 */
export async function getStockAvailability(
  session: Session | null,
  filters: StockAvailabilityFilters = {},
): Promise<StockAvailabilityRow[]> {
  const stockScope = worksiteScopeSql(session, worksiteStock.worksiteId, filters.worksiteId)
  const requestScope = worksiteScopeSql(session, purchaseRequests.worksiteId, filters.worksiteId)
  const orderScope = worksiteScopeSql(session, purchaseOrders.worksiteId, filters.worksiteId)

  const [stockRows, demandRows, deliveredRows, incomingRows] = await Promise.all([
    db
      .select({
        worksiteId: worksiteStock.worksiteId,
        productId: worksiteStock.productId,
        quantity: sql<number>`coalesce(sum(${worksiteStock.quantity}), 0)`,
      })
      .from(worksiteStock)
      .innerJoin(worksites, eq(worksites.id, worksiteStock.worksiteId))
      .innerJoin(products, eq(products.id, worksiteStock.productId))
      .where(and(stockScope, eq(worksites.isActive, true), eq(products.isService, false)))
      .groupBy(worksiteStock.worksiteId, worksiteStock.productId),
    db
      .select({
        worksiteId: purchaseRequests.worksiteId,
        productId: purchaseRequestItems.productId,
        quantity: sql<number>`coalesce(sum(${purchaseRequestItems.quantity}), 0)`,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
      .innerJoin(worksites, eq(worksites.id, purchaseRequests.worksiteId))
      .innerJoin(products, eq(products.id, purchaseRequestItems.productId))
      .where(and(
        requestScope,
        eq(worksites.isActive, true),
        eq(products.isService, false),
        notInArray(purchaseRequests.status, [...TERMINAL_REQUEST_STATUSES]),
        inArray(purchaseRequestItems.status, [...ACTIVE_DEMAND_ITEM_STATUSES]),
      ))
      .groupBy(purchaseRequests.worksiteId, purchaseRequestItems.productId),
    db
      .select({
        worksiteId: purchaseRequests.worksiteId,
        productId: purchaseRequestItems.productId,
        quantity: sql<number>`coalesce(sum(${deliveryItems.quantity}), 0)`,
      })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveries.id, deliveryItems.deliveryId))
      .innerJoin(purchaseRequestItems, eq(purchaseRequestItems.id, deliveryItems.requestItemId))
      .innerJoin(purchaseRequests, eq(purchaseRequests.id, purchaseRequestItems.requestId))
      .innerJoin(worksites, eq(worksites.id, purchaseRequests.worksiteId))
      .innerJoin(products, eq(products.id, purchaseRequestItems.productId))
      .where(and(
        requestScope,
        eq(worksites.isActive, true),
        eq(products.isService, false),
        isNull(deliveries.voidedAt),
        notInArray(purchaseRequests.status, [...TERMINAL_REQUEST_STATUSES]),
        inArray(purchaseRequestItems.status, [...ACTIVE_DEMAND_ITEM_STATUSES]),
      ))
      .groupBy(purchaseRequests.worksiteId, purchaseRequestItems.productId),
    db
      .select({
        worksiteId: purchaseOrders.worksiteId,
        productId: purchaseOrderItems.productId,
        ordered: sql<number>`coalesce(sum(${purchaseOrderItems.quantity}), 0)`,
        receivedAtFaena: sql<number>`coalesce(sum(${purchaseOrderItems.quantityReceived}), 0)`,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
      .innerJoin(worksites, eq(worksites.id, purchaseOrders.worksiteId))
      .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
      .where(and(
        orderScope,
        eq(worksites.isActive, true),
        eq(products.isService, false),
        eq(purchaseOrderItems.status, "issued"),
        inArray(purchaseOrders.status, RECEIVABLE_ORDER_STATUSES),
      ))
      .groupBy(purchaseOrders.worksiteId, purchaseOrderItems.productId),
  ])

  const stockByKey = toQuantityMap(stockRows)
  const demandByKey = toQuantityMap(demandRows as AvailabilityAggregateRow[])
  const deliveredByKey = toQuantityMap(deliveredRows as AvailabilityAggregateRow[])
  const incomingByKey = new Map(
    (incomingRows as IncomingAggregateRow[]).flatMap((row) => row.productId ? [[
      availabilityKey(row.worksiteId, row.productId),
      {
        ordered: Number(row.ordered ?? 0),
        receivedAtFaena: Number(row.receivedAtFaena ?? 0),
      },
    ] as const] : []),
  )
  const keys = new Set([
    ...stockByKey.keys(),
    ...demandByKey.keys(),
    ...deliveredByKey.keys(),
    ...incomingByKey.keys(),
  ])

  return [...keys]
    .map((key) => {
      const [worksiteId, productId] = key.split("\u0000") as [string, string]
      return {
        worksiteId,
        productId,
        ...computeStockAvailability({
          onHand: stockByKey.get(key) ?? 0,
          approvedDemand: demandByKey.get(key) ?? 0,
          delivered: deliveredByKey.get(key) ?? 0,
          ordered: incomingByKey.get(key)?.ordered ?? 0,
          receivedAtFaena: incomingByKey.get(key)?.receivedAtFaena ?? 0,
        }),
      }
    })
    .sort((left, right) => left.worksiteId.localeCompare(right.worksiteId)
      || left.productId.localeCompare(right.productId))
}

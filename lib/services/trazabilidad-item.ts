/**
 * Trazabilidad item detail service.
 *
 * Fetches the full lifecycle of a single purchase_request_item:
 * request → approval → OC → receipt → delivery, with all related entities.
 */
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, requestItemAttributes,
  approvalDecisions, purchaseOrders, purchaseOrderItems,
  receipts, receiptItems,
  deliveries, deliveryItems,
  statusHistory, users, products, worksites, workers, suppliers,
} from "@/db/schema"
import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { canAccessWorksite } from "@/lib/auth/scope"
import type { Session } from "next-auth"

export interface ItemDetailData {
  item: {
    id: string
    requestId: string
    requestCode: string
    worksiteId: string
    worksiteName: string
    productId: string | null
    productName: string
    productSku: string | null
    productNameFree: string | null
    quantity: number
    unitOfMeasure: string
    status: string
    urgency: string | null
    requiredDate: string | null
    notes: string | null
    createdAt: string
    requesterName: string
    requesterEmail: string
    attributes: Array<{ name: string; value: string }>
  }
  approvals: Array<{
    id: string
    type: string
    decidedByName: string
    decidedByEmail: string
    decidedAt: string
    reason: string | null
    modifiedQty: number | null
    roleContext: string | null
  }>
  ocItems: Array<{
    id: string
    ocId: string
    ocCode: string
    ocStatus: string
    supplierName: string
    quantity: number
    unitPrice: number
    receivedAtFaena: number
    receivedAtOffice: number
  }>
  receipts: Array<{
    id: string
    code: string
    locationType: string
    receivedByName: string
    receivedAt: string
    quantityReceived: number
    quantityRejected: number
    notes: string | null
  }>
  deliveries: Array<{
    id: string
    code: string
    destinationType: string
    deliveredByName: string
    deliveredAt: string
    workerName: string | null
    worksiteName: string | null
    receiverName: string | null
    quantity: number
    returnQuantity: number | null
    returnReason: string | null
    notes: string | null
  }>
  timeline: Array<{
    id: string
    fromStatus: string | null
    toStatus: string
    changedBy: string | null
    changedAt: string
    reason: string | null
    userName: string | null
    userEmail: string | null
  }>
}

/**
 * Fetches the complete lifecycle data for a single request item.
 * Returns null if the item doesn't exist or the user lacks access.
 */
export async function getItemDetail(
  session: Session,
  itemId: string,
): Promise<ItemDetailData | null> {
  // 1. Fetch the item with its parent request and product
  const itemRow = await db
    .select({
      id:              purchaseRequestItems.id,
      requestId:       purchaseRequestItems.requestId,
      productId:       purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      quantity:        purchaseRequestItems.quantity,
      unitOfMeasure:   purchaseRequestItems.unitOfMeasure,
      status:          purchaseRequestItems.status,
      urgency:         purchaseRequestItems.urgency,
      requiredDate:    purchaseRequestItems.requiredDate,
      notes:           purchaseRequestItems.notes,
      createdAt:       purchaseRequestItems.createdAt,
      requestCode:     purchaseRequests.code,
      worksiteId:      purchaseRequests.worksiteId,
      requesterId:     purchaseRequests.requesterId,
      productName:     products.name,
      productSku:      products.sku,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .leftJoin(products, eq(purchaseRequestItems.productId, products.id))
    .where(eq(purchaseRequestItems.id, itemId))
    .limit(1)

  const item = itemRow[0]
  if (!item) return null

  // RBAC check
  if (!canAccessWorksite(session, item.worksiteId)) return null

  // 2. Fetch requester and worksite names
  const [requesterRow, worksiteRow] = await Promise.all([
    db.select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, item.requesterId))
      .limit(1),
    db.select({ name: worksites.name })
      .from(worksites)
      .where(eq(worksites.id, item.worksiteId))
      .limit(1),
  ])

  // 3. Fetch item attributes
  const attrRows = await db
    .select({ name: requestItemAttributes.attributeName, value: requestItemAttributes.value })
    .from(requestItemAttributes)
    .where(eq(requestItemAttributes.requestItemId, itemId))

  // 4. Fetch approval decisions
  const approvalRows = await db
    .select({
      id:           approvalDecisions.id,
      type:         approvalDecisions.type,
      decidedByName: users.name,
      decidedByEmail: users.email,
      decidedAt:    approvalDecisions.decidedAt,
      reason:       approvalDecisions.reason,
      modifiedQty:  approvalDecisions.modifiedQty,
      roleContext:  approvalDecisions.roleContext,
    })
    .from(approvalDecisions)
    .innerJoin(users, eq(approvalDecisions.decidedBy, users.id))
    .where(eq(approvalDecisions.requestItemId, itemId))
    .orderBy(asc(approvalDecisions.decidedAt))

  // 5. Fetch OC items linked to this request item
  const ocItemRows = await db
    .select({
      id:               purchaseOrderItems.id,
      ocId:             purchaseOrderItems.purchaseOrderId,
      ocCode:           purchaseOrders.code,
      ocStatus:         purchaseOrders.status,
      supplierName:     suppliers.name,
      quantity:         purchaseOrderItems.quantity,
      unitPrice:        purchaseOrderItems.unitPrice,
      quantityReceived: purchaseOrderItems.quantityReceived,
      quantityOfficeReceived: purchaseOrderItems.quantityOfficeReceived,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(eq(purchaseOrderItems.requestItemId, itemId))
    .orderBy(asc(purchaseOrders.createdAt))

  const ocItemIds = ocItemRows.map((oi) => oi.id)

  // 6. Fetch receipt items for these OC items
  const receiptRows = ocItemIds.length > 0
    ? await db
        .select({
          receiptId:        receiptItems.receiptId,
          receiptCode:      receipts.code,
          locationType:     receipts.locationType,
          receivedByName:   users.name,
          receivedAt:       receipts.receivedAt,
          quantityReceived: receiptItems.quantityReceived,
          quantityRejected: receiptItems.quantityRejected,
          notes:            receiptItems.notes,
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
        .innerJoin(users, eq(receipts.receivedBy, users.id))
        .where(inArray(receiptItems.purchaseOrderItemId, ocItemIds))
        .orderBy(asc(receipts.receivedAt))
    : []

  // 7. Fetch delivery items for this request item
  const deliveryRows = await db
    .select({
      id:               deliveryItems.id,
      deliveryCode:     deliveries.code,
      destinationType:  deliveries.destinationType,
      deliveredByName:  users.name,
      deliveredAt:      deliveries.deliveredAt,
      workerName:       workers.firstName,
      workerLastName:   workers.lastName,
      worksiteName:     worksites.name,
      receiverName:     deliveries.receiverName,
      quantity:         deliveryItems.quantity,
      returnQuantity:   deliveryItems.returnQuantity,
      returnReason:     deliveryItems.returnReason,
      notes:            deliveryItems.notes,
    })
    .from(deliveryItems)
    .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
    .innerJoin(users, eq(deliveries.deliveredBy, users.id))
    .leftJoin(workers, eq(deliveries.workerId, workers.id))
    .leftJoin(worksites, eq(deliveries.worksiteId, worksites.id))
    .where(eq(deliveryItems.requestItemId, itemId))
    .orderBy(asc(deliveries.deliveredAt))

  // 8. Fetch status history for this item
  const historyRows = await db
    .select({
      id:         statusHistory.id,
      fromStatus: statusHistory.fromStatus,
      toStatus:   statusHistory.toStatus,
      changedBy:  statusHistory.changedBy,
      changedAt:  statusHistory.changedAt,
      reason:     statusHistory.reason,
      userName:   users.name,
      userEmail:  users.email,
    })
    .from(statusHistory)
    .leftJoin(users, eq(statusHistory.changedBy, users.id))
    .where(
      and(
        eq(statusHistory.entityType, "purchase_request_item"),
        eq(statusHistory.entityId, itemId),
      ),
    )
    .orderBy(desc(statusHistory.changedAt))

  return {
    item: {
      id:              item.id,
      requestId:       item.requestId,
      requestCode:     item.requestCode,
      worksiteId:      item.worksiteId,
      worksiteName:    worksiteRow[0]?.name ?? item.worksiteId,
      productId:       item.productId,
      productName:     item.productName ?? item.productNameFree ?? "—",
      productSku:      item.productSku ?? null,
      productNameFree: item.productNameFree,
      quantity:        item.quantity,
      unitOfMeasure:   item.unitOfMeasure,
      status:          item.status,
      urgency:         item.urgency,
      requiredDate:    item.requiredDate,
      notes:           item.notes,
      createdAt:       item.createdAt,
      requesterName:   requesterRow[0]?.name ?? "—",
      requesterEmail:  requesterRow[0]?.email ?? "—",
      attributes:      attrRows,
    },
    approvals: approvalRows.map((a) => ({
      id:            a.id,
      type:          a.type,
      decidedByName: a.decidedByName,
      decidedByEmail: a.decidedByEmail,
      decidedAt:     a.decidedAt,
      reason:        a.reason,
      modifiedQty:   a.modifiedQty,
      roleContext:   a.roleContext,
    })),
    ocItems: ocItemRows.map((oi) => ({
      id:               oi.id,
      ocId:             oi.ocId,
      ocCode:           oi.ocCode,
      ocStatus:         oi.ocStatus,
      supplierName:     oi.supplierName,
      quantity:         oi.quantity,
      unitPrice:        oi.unitPrice,
      receivedAtFaena:  oi.quantityReceived,
      receivedAtOffice: oi.quantityOfficeReceived,
    })),
    receipts: receiptRows.map((r) => ({
      id:               r.receiptId,
      code:             r.receiptCode,
      locationType:     r.locationType,
      receivedByName:   r.receivedByName,
      receivedAt:       r.receivedAt,
      quantityReceived: r.quantityReceived,
      quantityRejected: r.quantityRejected,
      notes:            r.notes,
    })),
    deliveries: deliveryRows.map((d) => ({
      id:               d.id,
      code:             d.deliveryCode,
      destinationType:  d.destinationType,
      deliveredByName:  d.deliveredByName,
      deliveredAt:      d.deliveredAt,
      workerName:       d.workerName && d.workerLastName
        ? `${d.workerName} ${d.workerLastName}`
        : d.receiverName ?? null,
      worksiteName:     d.worksiteName ?? null,
      receiverName:     d.receiverName,
      quantity:         d.quantity,
      returnQuantity:   d.returnQuantity,
      returnReason:     d.returnReason,
      notes:            d.notes,
    })),
    timeline: historyRows.map((h) => ({
      id:         h.id,
      fromStatus: h.fromStatus,
      toStatus:   h.toStatus,
      changedBy:  h.changedBy,
      changedAt:  h.changedAt,
      reason:     h.reason,
      userName:   h.userName,
      userEmail:  h.userEmail,
    })),
  }
}

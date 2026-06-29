import { db } from "@/db"
import { receiptItems } from "@/db/schema"
import { inArray } from "drizzle-orm"

export async function getOcReconciliation(orderId: string, itemIds: string[]) {
  if (itemIds.length === 0) return { receivedByItem: new Map<string, number>(), totalReceived: 0 }

  const rows = await db
    .select({
      purchaseOrderItemId: receiptItems.purchaseOrderItemId,
      quantityReceived: receiptItems.quantityReceived,
    })
    .from(receiptItems)
    .where(inArray(receiptItems.purchaseOrderItemId, itemIds))

  const receivedByItem = new Map<string, number>()
  let totalReceived = 0
  for (const row of rows) {
    const current = receivedByItem.get(row.purchaseOrderItemId) ?? 0
    const qty = row.quantityReceived ?? 0
    receivedByItem.set(row.purchaseOrderItemId, current + qty)
    totalReceived += qty
  }

  return { receivedByItem, totalReceived }
}

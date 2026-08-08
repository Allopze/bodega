import { db } from "@/db"
import { receiptItems, receipts } from "@/db/schema"
import { and, eq, inArray } from "drizzle-orm"

export async function getOcReconciliation(orderId: string, itemIds: string[]) {
  if (itemIds.length === 0) return { receivedByItem: new Map<string, number>(), totalReceived: 0 }

  // Cada unidad pasa por oficina Y faena en el flujo de dos etapas; solo la
  // etapa faena representa mercadería efectivamente recibida (genera stock).
  const rows = await db
    .select({
      purchaseOrderItemId: receiptItems.purchaseOrderItemId,
      quantityReceived: receiptItems.quantityReceived,
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .where(and(
      inArray(receiptItems.purchaseOrderItemId, itemIds),
      eq(receipts.locationType, "faena"),
    ))

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

/**
 * Purchase order hard-delete (permanent removal).
 * Reverts associated request items, cleans up files, audit trail.
 */

import fs from "node:fs/promises"
import { eq, and, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseRequestItems, quotations, purchaseOrderInvoices } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { resolveInvoiceAttachmentFile } from "@/lib/storage/config"
import { isOrderDeletable } from "@/lib/services/purchasing.constants"

/**
 * Elimina permanentemente una OC y su data dependiente.
 * Revierte los request items vinculados a pending_purchase, limpia archivos de disco.
 */
export async function deleteOrder(
  orderId: string,
  userId: string,
  worksiteIds: string[] | "all" = "all",
  opts?: { userEmail?: string },
): Promise<void> {
  // Pre-fetch invoice file paths antes de la transacción
  const invoiceFiles = await db
    .select({ filePath: purchaseOrderInvoices.filePath })
    .from(purchaseOrderInvoices)
    .where(eq(purchaseOrderInvoices.purchaseOrderId, orderId))

  await db.transaction(async (tx) => {
    const order = await tx.query.purchaseOrders.findFirst({
      where: eq(purchaseOrders.id, orderId),
    })
    if (!order) throw new Error(`Orden ${orderId} no encontrada`)
    if (worksiteIds !== "all" && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a la faena de esta orden")
    }
    if (!isOrderDeletable(order.status)) {
      throw new Error(`No se puede eliminar una orden en estado '${order.status}'`)
    }

    const now = new Date().toISOString()

    // 1. Revertir request items vinculados a pending_purchase
    const ocItems = await tx
      .select({ id: purchaseOrderItems.id, requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)

    if (requestItemIds.length > 0) {
      await tx
        .update(purchaseRequestItems)
        .set({ status: "pending_purchase", updatedAt: now })
        .where(
          and(
            inArray(purchaseRequestItems.id, requestItemIds),
            inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"]),
          ),
        )

      for (const reqItemId of requestItemIds) {
        await recordStatusChange(
          {
            entityType: "request_item",
            entityId:   reqItemId,
            fromStatus: "in_purchase_order",
            toStatus:   "pending_purchase",
            changedBy:  userId,
          },
          tx,
        )
      }
    }

    // 2. Desligar cotizaciones con referencia nullable a esta OC
    await tx
      .update(quotations)
      .set({ purchaseOrderId: null })
      .where(eq(quotations.purchaseOrderId, orderId))

    // 3. Auditoría antes del delete (entityId string sobrevive)
    await recordAudit(
      {
        userId,
        userEmail:  opts?.userEmail,
        action:     "delete",
        entityType: "purchase_order",
        entityId:   orderId,
        entityCode: order.code,
        oldState:   { status: order.status },
      },
      tx,
    )

    // 4. Eliminar la OC — cascade borra purchaseOrderItems e invoices
    await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, orderId))
  })

  // 5. Limpiar archivos de facturas del disco (best-effort)
  await Promise.all(
    invoiceFiles.map((f) => {
      const absPath = resolveInvoiceAttachmentFile(f.filePath)
      return absPath ? fs.unlink(absPath).catch(() => undefined) : Promise.resolve()
    }),
  )
}

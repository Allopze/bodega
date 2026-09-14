/**
 * Anular una recepción.
 *
 * `REC-003` (auditoría 2026-09-14), patrón P5. Una recepción equivocada no
 * tenía salida: `receipts` no tenía columnas de anulación y no existía **ni un
 * solo `update` sobre la tabla** en toda la aplicación. El único remedio era un
 * ajuste de inventario de Bodega, que corrige el saldo pero no revierte el
 * avance de la orden de compra, ni el estado del ítem de solicitud, ni la
 * proyección de conciliación tributaria que se recalcula en el mismo commit.
 *
 * ## Qué revierte
 *
 * Todo lo que `registerReceipt` escribió: el stock que ingresó, las cantidades
 * recibidas de la OC, el estado del ítem de solicitud, el estado de la propia
 * orden y la proyección de conciliación.
 *
 * ## Qué se niega a revertir, y por qué
 *
 * La regla no es nueva: es la que el repositorio ya aplica al cerrar una faena
 * (`assertWorksiteHasNoStock`), al desactivar un producto con saldo
 * (`CAT-001`) y al dar de baja más de lo disponible (`STK-001`). **No se
 * deshace lo que ya no se puede deshacer.** Si la mercadería salió —se entregó,
 * se despachó a faena, se consumió—, revertir el ingreso dejaría un saldo
 * negativo o una entrega sin respaldo, que es peor que el error original.
 *
 * En esos casos el remedio sigue siendo el ajuste de inventario, y el mensaje
 * lo dice en vez de dejar a quien lo intenta adivinando.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  dispatchGuides,
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  receiptItems,
  receipts,
  worksiteStock,
} from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { isValidReason, reasonRequiredMessage } from "@/lib/validation/reason-thresholds"
import { applyMovementTx } from "./stock"
import { rollupOrderReceiptStatus } from "./receiving"
import { persistPurchaseOrderInvoiceReconciliationTx } from "./purchasing-module/invoice-reconciliation-service"

export interface VoidReceiptInput {
  receiptId: string
  reason: string
  voidedBy: string
  userEmail?: string
}

/**
 * Estados de un ítem de solicitud que significan que la mercadería **ya salió**
 * de bodega. Revertir su ingreso dejaría la entrega sin respaldo.
 */
const ITEM_ALREADY_OUT = ["partially_delivered", "delivered"] as const

export async function voidReceipt(
  input: VoidReceiptInput,
  worksiteIds: string[] | "all" = "all",
): Promise<{ code: string; reversedMovements: number }> {
  const reason = input.reason.trim()
  if (!isValidReason(reason)) throw new Error(reasonRequiredMessage("por qué se anula la recepción"))

  return db.transaction(async (tx) => {
    const [receipt] = await tx.select().from(receipts)
      .where(eq(receipts.id, input.receiptId)).for("update")
    if (!receipt) throw new Error("Recepción no encontrada")
    if (receipt.status === "voided") throw new Error("La recepción ya está anulada")
    if (worksiteIds !== "all" && receipt.worksiteId && !worksiteIds.includes(receipt.worksiteId)) {
      throw new Error("No tienes acceso a la faena de esta recepción")
    }

    /*
     * La guía interna que preparó una recepción de oficina: si ya salió, la
     * mercadería no está donde el reverso la buscaría. Anular la guía es un
     * acto propio, con su propio motivo y su propio responsable, y tiene que
     * hacerse antes.
     */
    const guides = await tx.select({ code: dispatchGuides.code, status: dispatchGuides.status })
      .from(dispatchGuides).where(eq(dispatchGuides.receiptId, receipt.id))
    const despachada = guides.find((guide) => !["draft", "cancelled"].includes(guide.status))
    if (despachada) {
      throw new Error(
        `No se puede anular: la guía ${despachada.code} ya despachó esta mercadería a faena. `
        + "Anula primero la guía, o corrige con un ajuste de inventario.",
      )
    }

    const lines = await tx.select({
      id: receiptItems.id,
      purchaseOrderItemId: receiptItems.purchaseOrderItemId,
      quantityReceived: receiptItems.quantityReceived,
    }).from(receiptItems).where(eq(receiptItems.receiptId, receipt.id))

    const orderItemIds = lines.map((line) => line.purchaseOrderItemId)
    const orderItems = orderItemIds.length === 0 ? [] : await tx.select({
      id: purchaseOrderItems.id,
      productId: purchaseOrderItems.productId,
      requestItemId: purchaseOrderItems.requestItemId,
      quantity: purchaseOrderItems.quantity,
      quantityReceived: purchaseOrderItems.quantityReceived,
      quantityOfficeReceived: purchaseOrderItems.quantityOfficeReceived,
    }).from(purchaseOrderItems).where(inArray(purchaseOrderItems.id, orderItemIds)).for("update")
    const orderItemById = new Map(orderItems.map((item) => [item.id, item]))

    // El ítem de solicitud que ya salió en entrega: no se toca su historia.
    const requestItemIds = orderItems.flatMap((item) => (item.requestItemId ? [item.requestItemId] : []))
    const requestItems = requestItemIds.length === 0 ? [] : await tx.select({
      id: purchaseRequestItems.id,
      status: purchaseRequestItems.status,
    }).from(purchaseRequestItems).where(inArray(purchaseRequestItems.id, requestItemIds)).for("update")
    const yaEntregado = requestItems.find((item) => (ITEM_ALREADY_OUT as readonly string[]).includes(item.status))
    if (yaEntregado) {
      throw new Error(
        "No se puede anular: alguno de los ítems ya se entregó. "
        + "Corrige con un ajuste de inventario, que deja su propio folio y motivo.",
      )
    }

    const isOffice = receipt.locationType === "office"
    /*
     * `receipts.worksiteId` es nullable. Sin faena no hubo movimiento de stock
     * que revertir —el ingreso se hizo en otra parte o no se hizo— y el reverso
     * se limita a las cantidades y los estados.
     */
    const stockWorksiteId = receipt.worksiteId
    let reversedMovements = 0

    for (const line of lines) {
      const orderItem = orderItemById.get(line.purchaseOrderItemId)
      if (!orderItem || line.quantityReceived <= 0) continue

      // 1. Las cantidades de la OC vuelven a lo que eran antes de esta recepción.
      const current = isOffice
        ? (orderItem.quantityOfficeReceived ?? 0)
        : (orderItem.quantityReceived ?? 0)
      const restored = Math.max(0, current - line.quantityReceived)
      await tx.update(purchaseOrderItems)
        .set(isOffice ? { quantityOfficeReceived: restored } : { quantityReceived: restored })
        .where(eq(purchaseOrderItems.id, orderItem.id))

      // 2. El stock que ingresó vuelve a salir, con su propio tipo de movimiento
      //    y su referencia: el kardex muestra el ingreso y su reverso, no un hueco.
      if (!orderItem.productId || !stockWorksiteId) continue
      const product = await tx.query.products.findFirst({ where: eq(products.id, orderItem.productId) })
      if (product?.isService) continue

      const [onHand] = await tx.select({ quantity: worksiteStock.quantity })
        .from(worksiteStock)
        .where(and(
          eq(worksiteStock.worksiteId, stockWorksiteId),
          eq(worksiteStock.productId, orderItem.productId),
        ))
      if ((onHand?.quantity ?? 0) < line.quantityReceived) {
        throw new Error(
          `No se puede anular: de ${product?.name ?? "un producto"} quedan ${onHand?.quantity ?? 0} `
          + `y la recepción ingresó ${line.quantityReceived}. Lo recibido ya se movió; `
          + "corrige con un ajuste de inventario.",
        )
      }

      await applyMovementTx(tx, {
        worksiteId: stockWorksiteId,
        productId: orderItem.productId,
        type: "egreso_anulacion",
        quantity: -line.quantityReceived,
        referenceType: "receipt_void",
        referenceId: receipt.id,
        performedBy: input.voidedBy,
        userEmail: input.userEmail,
        reason,
        notes: `Anulación de la recepción ${receipt.code}`,
      })
      reversedMovements += 1
    }

    /*
     * 3. El estado del ítem de solicitud retrocede.
     *
     * `ALLOWED_TRANSITIONS` sólo describe avances, así que esto va por SQL
     * directo con guarda —exactamente como el rollback que ya hacen
     * `cancelOrder` y `deleteOrder`, documentado en `item-state-module/types.ts`
     * como excepción intencional—. El estado de destino se recalcula de lo que
     * queda, no se adivina.
     */
    for (const orderItem of orderItems) {
      if (!orderItem.requestItemId) continue
      const officeLeft = isOffice
        ? Math.max(0, (orderItem.quantityOfficeReceived ?? 0) - (lines.find((l) => l.purchaseOrderItemId === orderItem.id)?.quantityReceived ?? 0))
        : (orderItem.quantityOfficeReceived ?? 0)
      const faenaLeft = isOffice
        ? (orderItem.quantityReceived ?? 0)
        : Math.max(0, (orderItem.quantityReceived ?? 0) - (lines.find((l) => l.purchaseOrderItemId === orderItem.id)?.quantityReceived ?? 0))

      const restoredStatus = faenaLeft >= orderItem.quantity ? "received"
        : faenaLeft > 0 ? "partially_received"
        : officeLeft >= orderItem.quantity ? "office_received"
        : officeLeft > 0 ? "partially_office_received"
        : "purchased"

      const [before] = await tx.select({ status: purchaseRequestItems.status })
        .from(purchaseRequestItems).where(eq(purchaseRequestItems.id, orderItem.requestItemId))
      if (!before || before.status === restoredStatus) continue

      await tx.update(purchaseRequestItems)
        .set({ status: restoredStatus, updatedAt: new Date().toISOString() })
        .where(and(
          eq(purchaseRequestItems.id, orderItem.requestItemId),
          eq(purchaseRequestItems.status, before.status),
        ))
      await recordStatusChange({
        entityType: "request_item",
        entityId: orderItem.requestItemId,
        fromStatus: before.status,
        toStatus: restoredStatus,
        changedBy: input.voidedBy,
        reason: `Anulación de la recepción ${receipt.code}: ${reason}`,
      }, tx)
    }

    // 4. La guía en borrador que preparó esta recepción deja de tener sentido.
    await tx.delete(dispatchGuides).where(and(
      eq(dispatchGuides.receiptId, receipt.id),
      eq(dispatchGuides.status, "draft"),
    ))

    // 5. La recepción queda anulada, no borrada.
    const now = new Date().toISOString()
    await tx.update(receipts).set({
      status: "voided", voidedAt: now, voidedBy: input.voidedBy, voidReason: reason,
    }).where(eq(receipts.id, receipt.id))

    /*
     * 6. El estado de la orden y la proyección tributaria se recalculan en el
     *    mismo commit, igual que al registrar: si la orden se había cerrado por
     *    recepción completa, vuelve a estar abierta.
     */
    const [order] = await tx.select({ id: purchaseOrders.id, deliveryMode: purchaseOrders.deliveryMode, status: purchaseOrders.status })
      .from(purchaseOrders).where(eq(purchaseOrders.id, receipt.purchaseOrderId)).for("update")
    if (order) {
      /*
       * `null` significa «no hay recepción alguna que resumir», que tras anular
       * la única recepción de la orden es exactamente el caso: la orden vuelve
       * a estar enviada y a la espera.
       */
      const rolledUp = await rollupOrderReceiptStatus(order.id, tx, order.deliveryMode) ?? "sent"
      if (order.status !== rolledUp) {
        await tx.update(purchaseOrders)
          .set({ status: rolledUp, updatedAt: now })
          .where(eq(purchaseOrders.id, order.id))
        await recordStatusChange({
          entityType: "purchase_order",
          entityId: order.id,
          fromStatus: order.status,
          toStatus: rolledUp,
          changedBy: input.voidedBy,
          reason: `Anulación de la recepción ${receipt.code}: ${reason}`,
        }, tx)
      }
      await persistPurchaseOrderInvoiceReconciliationTx(tx, order.id)
    }

    await recordAudit({
      userId: input.voidedBy,
      userEmail: input.userEmail,
      action: "update",
      entityType: "receipt",
      entityId: receipt.id,
      entityCode: receipt.code,
      oldState: { status: receipt.status },
      newState: { status: "voided", reversedMovements },
      reason,
    }, tx)

    return { code: receipt.code, reversedMovements }
  })
}

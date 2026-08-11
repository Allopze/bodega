/**
 * Receiving-related order operations — close orders after receipt.
 */

import { and, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrderItems, purchaseOrders, purchaseRequestItems, receiptItems, receipts, requestItemAttributes } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { lockRequestsForRollupTx, rollupRequestStatus } from "@/lib/services/item-state-module/rollup"
import { lockPurchaseRequestItemsTx } from "./purchasable-coverage"

/* ── Close order (recepción iniciada/recibida → closed) ──────────────────────── */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function closeOrder(
  orderId: string,
  userId: string,
  reason: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  if (!reason?.trim()) throw new Error("Se requiere un motivo para finalizar la orden")

  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId)).for("update")
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (!["partially_office_received", "office_received", "partially_received", "received"].includes(order.status)) {
      throw new Error(`No se puede cerrar una orden en estado '${order.status}'`)
    }

    // LOG-7/DAT-17 (decisión: bloquear): cerrar con mercadería recibida en
    // oficina pero sin llegar a faena mandaba ese saldo a re-compra —el ítem
    // volvía a 'pending_purchase' y se compraba de nuevo lo que ya estaba
    // físicamente en la oficina— y en el cierre parcial el excedente se
    // recortaba con LEAST sin dejar rastro. Hay que registrar la llegada a
    // faena (o gestionar el excedente) antes de poder cerrar.
    // El saldo que sigue en oficina se mide contra lo DISPUESTO en faena
    // (recibido + rechazado + dañado), no contra `quantityReceived`: lo que se
    // rechaza o llega dañado en el traslado consume el cupo de la etapa faena
    // sin subir ese contador, y comparar contra él dejaba la OC sin ninguna
    // salida (no se podía recibir más, ni cerrar, ni anular).
    const faenaDiscarded = sql<number>`coalesce((
      select sum(${receiptItems.quantityRejected} + ${receiptItems.quantityDamaged})
      from ${receiptItems}
      join ${receipts} on ${receipts.id} = ${receiptItems.receiptId}
      where ${receiptItems.purchaseOrderItemId} = ${purchaseOrderItems.id}
        and ${receipts.locationType} = 'faena'
    ), 0)`
    const [officePending] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(purchaseOrderItems)
      .where(and(
        eq(purchaseOrderItems.purchaseOrderId, orderId),
        sql`${purchaseOrderItems.quantityOfficeReceived} > ${purchaseOrderItems.quantityReceived} + ${faenaDiscarded}`,
      ))
    if (Number(officePending?.n ?? 0) > 0) {
      throw new Error("No se puede cerrar: hay mercadería recibida en oficina que aún no llega a faena. Registra la llegada a faena antes de cerrar la orden.")
    }

    await closeOrderTx(tx, order, userId, reason, opts)
  })
}

// Cascade shared by the manual close action and the auto-close that fires when a
// receipt brings an order to "received" (see rollupOrderReceiptStatus in ../receiving.ts).
// Caller is responsible for locking/validating the order beforehand.
export async function closeOrderTx(
  tx: Tx,
  order: { id: string; code: string; status: string },
  userId: string,
  reason: string,
  opts?: { userEmail?: string },
): Promise<void> {
  const orderId = order.id
  const now = new Date().toISOString()
  await tx
    .update(purchaseOrders)
    .set({ status: "closed", updatedAt: now })
    .where(eq(purchaseOrders.id, orderId))

  // DAT-1: esta cascada muta ítems de solicitud y recalcula sus padres, y no
  // lockeaba ninguno de los dos. El orden es el de siempre —ítems primero, en
  // orden léxico, padres después— y el caller ya tiene el lock de la OC, así
  // que dos cierres/anulaciones sobre la misma orden se serializan antes de
  // llegar hasta acá.
  const orderRequestItemIds = (await tx
    .select({ requestItemId: purchaseOrderItems.requestItemId })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, orderId)))
    .flatMap((row) => row.requestItemId ? [row.requestItemId] : [])
  const lockedRequestItems = await lockPurchaseRequestItemsTx(tx, orderRequestItemIds)
  await lockRequestsForRollupTx(tx, lockedRequestItems.map((item) => item.requestId))

  const linkedItems = await tx
    .select({
      orderItemId: purchaseOrderItems.id,
      requestItemId: purchaseOrderItems.requestItemId,
      ordered: purchaseOrderItems.quantity,
      received: purchaseOrderItems.quantityReceived,
      productId: purchaseRequestItems.productId,
      productNameFree: purchaseRequestItems.productNameFree,
      currentQuantity: purchaseRequestItems.quantity,
      unitOfMeasure: purchaseRequestItems.unitOfMeasure,
      currentStatus: purchaseRequestItems.status,
      requestId: purchaseRequestItems.requestId,
      urgency: purchaseRequestItems.urgency,
      requiredDate: purchaseRequestItems.requiredDate,
      workerId: purchaseRequestItems.workerId,
      suggestedSupplierId: purchaseRequestItems.suggestedSupplierId,
      supplierHint: purchaseRequestItems.supplierHint,
      sortOrder: purchaseRequestItems.sortOrder,
      notes: purchaseRequestItems.notes,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseRequestItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id))
    .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

  /**
   * Los tres destinos posibles de una línea al cerrar, clasificados por lo
   * ÚNICO que decide el destino: cuánto llegó a faena.
   *
   *  - nada        → el ítem vuelve a la cola de compra y su línea se anula.
   *  - parcial     → lo recibido se conserva y el saldo se separa en un hermano.
   *  - completo    → no hay nada que hacer.
   *
   * La clasificación es total a propósito. Antes eran dos `filter` con listas
   * de estado escritas a mano que no cubrían todo el espacio: una línea con
   * `received > 0` cuyo ítem siguiera en 'in_purchase_order'/'purchased' no
   * caía en ninguna de las dos, así que ni se dividía ni se liberaba — el saldo
   * desaparecía sin rastro y la línea quedaba viva sobre una OC cerrada. El
   * estado del ítem sigue acotando los UPDATE (en el WHERE, que es donde
   * protege contra una mutación concurrente), pero ya no decide el destino.
   */
  const receivedNothing: typeof linkedItems = []
  const receivedPartially: typeof linkedItems = []
  for (const item of linkedItems) {
    if (!item.requestItemId) continue
    if (item.received <= 0) receivedNothing.push(item)
    else if (item.received < item.currentQuantity) receivedPartially.push(item)
  }

  if (receivedNothing.length > 0) {
    const unresolvedIds = receivedNothing.map((item) => item.requestItemId!)
    // DAT-10: sólo se traza lo que el WHERE realmente movió. Ahora entran acá
    // líneas cuyo ítem puede estar en cualquier estado (p. ej. 'rejected' si la
    // solicitud se canceló), y esas no se tocan: el historial no debe inventar
    // una transición que no ocurrió.
    const releasedItems = await tx
      .update(purchaseRequestItems)
      .set({ status: "pending_purchase", updatedAt: now })
      .where(and(
        inArray(purchaseRequestItems.id, unresolvedIds),
        inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"]),
      ))
      .returning({ id: purchaseRequestItems.id })
    const releasedIds = new Set(releasedItems.map((item) => item.id))

    // La línea de OC que no recibió nada queda anulada junto con la devolución
    // del ítem a la cola de compra. Sin esto la línea seguía en 'issued' sobre
    // una OC cerrada, o sea contaba como cobertura activa
    // (`getPurchasableCoverage` / `itemHasNoActiveOrderSql`): el ítem volvía a
    // 'pending_purchase' y la bandeja lo contaba, pero el selector de
    // /compras/nueva lo descartaba por "ya tiene cobertura". El contador decía
    // 8 y "Crear OC" rebotaba con "no hay ítems pendientes". Anularla deja el
    // estado del ítem y la cobertura de acuerdo por construcción.
    await tx
      .update(purchaseOrderItems)
      .set({ status: "cancelled" })
      .where(and(
        eq(purchaseOrderItems.purchaseOrderId, orderId),
        inArray(purchaseOrderItems.id, receivedNothing.map((item) => item.orderItemId)),
      ))

    for (const item of receivedNothing.filter((i) => releasedIds.has(i.requestItemId!))) {
      await recordStatusChange({
        entityType: "request_item",
        entityId: item.requestItemId!,
        fromStatus: item.currentStatus,
        toStatus: "pending_purchase",
        changedBy: userId,
        reason,
      }, tx)
    }
  }

  for (const item of receivedPartially) {
    const remaining = item.ordered - item.received
    if (remaining <= 0) continue

    const splitItemId = nanoid()
    await tx
      .update(purchaseRequestItems)
      .set({ quantity: item.received })
      .where(eq(purchaseRequestItems.id, item.requestItemId!))

    await tx
      .update(purchaseOrderItems)
      .set({
        quantity: item.received,
        quantityOfficeReceived: sql`LEAST(${purchaseOrderItems.quantityOfficeReceived}, ${item.received})`,
      })
      .where(eq(purchaseOrderItems.id, item.orderItemId))

    await tx.insert(purchaseRequestItems).values({
      id: splitItemId,
      requestId: item.requestId,
      productId: item.productId,
      productNameFree: item.productNameFree,
      quantity: remaining,
      unitOfMeasure: item.unitOfMeasure,
      status: "pending_purchase",
      urgency: item.urgency,
      requiredDate: item.requiredDate,
      workerId: item.workerId,
      suggestedSupplierId: item.suggestedSupplierId,
      supplierHint: item.supplierHint,
      sortOrder: item.sortOrder + 1,
      notes: item.notes,
      splitFromItemId: item.requestItemId,
      createdAt: now,
      updatedAt: now,
    })

    const attrs = await tx
      .select({
        attributeId: requestItemAttributes.attributeId,
        attributeName: requestItemAttributes.attributeName,
        value: requestItemAttributes.value,
      })
      .from(requestItemAttributes)
      .where(eq(requestItemAttributes.requestItemId, item.requestItemId!))

    if (attrs.length > 0) {
      await tx.insert(requestItemAttributes).values(attrs.map((attr) => ({
        id: nanoid(),
        requestItemId: splitItemId,
        attributeId: attr.attributeId,
        attributeName: attr.attributeName,
        value: attr.value,
      })))
    }

    await recordStatusChange({
      entityType: "request_item",
      entityId: splitItemId,
      fromStatus: null,
      toStatus: "pending_purchase",
      changedBy: userId,
      reason,
    }, tx)
    await recordAudit({
      userId,
      userEmail: opts?.userEmail,
      action: "create",
      entityType: "request_item",
      entityId: splitItemId,
      newState: {
        status: "pending_purchase",
        splitFromItemId: item.requestItemId,
        quantity: remaining,
      },
      reason,
    }, tx)
  }

  const affectedRequestIds = [...new Set(linkedItems.map((item) => item.requestId))]
  for (const requestId of affectedRequestIds) {
    await rollupRequestStatus(requestId, tx, userId)
  }

  await recordStatusChange({
    entityType: "purchase_order",
    entityId:   orderId,
    fromStatus: order.status,
    toStatus:   "closed",
    changedBy:  userId,
    reason,
  }, tx)
  await recordAudit({
    userId,
    userEmail:  opts?.userEmail,
    action:     "status_change",
    entityType: "purchase_order",
    entityId:   orderId,
    entityCode: order.code,
    oldState:   { status: order.status },
    newState:   { status: "closed" },
    reason,
  }, tx)
}

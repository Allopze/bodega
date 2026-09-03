import { and, eq } from "drizzle-orm"
import { type Tx } from "@/db"
import { products, purchaseRequestItems } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { canTransition, getDeliveryTargetStatus, type ItemStatus } from "./types"
import { lockRequestsForRollupTx, rollupRequestStatus } from "./rollup"

/**
 * Transition a purchased item to received or partially_received at faena.
 * Called from lib/services/receiving.ts after creating a receipt item.
 * fullReceived = true → "received", false → "partially_received"
 */
export async function receiveItemTx(
  tx: Tx,
  itemId: string,
  userId: string,
  opts?: { fullReceived?: boolean; userEmail?: string },
): Promise<void> {
    // LOG-6/DAT-1: el caller de registerReceipt lockea la línea de OC, una fila
    // distinta — sin lock propio aquí, una recepción y una entrega concurrentes
    // sobre el MISMO ítem pueden intercalarse y regredir 'partially_delivered'
    // a 'received' con una lectura obsoleta.
    const [item] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, itemId))
      .for("update")
    if (!item) throw new Error(`Item ${itemId} not found`)
    // DAT-1: el padre después del ítem, antes de mutar.
    await lockRequestsForRollupTx(tx, [item.requestId])

    const allowedFrom: ItemStatus[] = [
      "purchased",
      "partially_office_received",
      "office_received",
      "partially_received",
      "partially_delivered",
    ]
    if (!allowedFrom.includes(item.status as ItemStatus)) {
      throw new Error(`Cannot receive item in state '${item.status}'`)
    }

    const product = item.productId
      ? await tx.query.products.findFirst({ where: eq(products.id, item.productId) })
      : null
    // Texto libre y productos de servicio no generan stock al recibirse, por lo
    // que no tienen una entrega posterior desde Bodega. Al completarse la
    // recepción llegan directamente al estado terminal; los productos físicos
    // de catálogo sí quedan "received" para su posterior entrega.
    const fullyReceivedTarget: ItemStatus = !item.productId || product?.isService
      ? "delivered"
      : "received"

    // Un ítem que ya salió en entrega parcial no retrocede cuando llega el saldo a
    // faena: conserva 'partially_delivered' y sólo se registra el ingreso.
    const targetStatus: ItemStatus = item.status === "partially_delivered"
      ? "partially_delivered"
      : opts?.fullReceived === false ? "partially_received" : fullyReceivedTarget

    // Mismo guardia que deliverItemTx: la segunda recepción parcial apunta al estado
    // que el ítem ya tiene ('partially_received' → 'partially_received') y eso no es
    // una transición — ALLOWED_TRANSITIONS sólo describe avances.
    const statusChanged = item.status !== targetStatus
    if (statusChanged && !canTransition(item.status as ItemStatus, targetStatus)) {
      throw new Error(`Cannot transition item from '${item.status}' to '${targetStatus}'`)
    }

    const now = new Date().toISOString()
    const [updated] = await tx
      .update(purchaseRequestItems)
      .set({ status: targetStatus, updatedAt: now })
      .where(and(eq(purchaseRequestItems.id, itemId), eq(purchaseRequestItems.status, item.status)))
      .returning({ id: purchaseRequestItems.id })
    if (!updated) throw new Error("El ítem ya no está disponible: posible concurrencia")

    if (statusChanged) {
      await recordStatusChange({
        entityType: "request_item",
        entityId:   itemId,
        fromStatus: item.status,
        toStatus:   targetStatus,
        changedBy:  userId,
      }, tx)
    }
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   { status: targetStatus },
    }, tx)

    await rollupRequestStatus(item.requestId, tx, userId)
}

/**
 * Mark the supplier checkpoint without pretending that the item is already at
 * its final faena. The counters on the PO are the source for `fullReceived`;
 * this transition only projects that checkpoint onto the request timeline.
 */
export async function receiveOfficeItemTx(
  tx: Tx,
  itemId: string,
  userId: string,
  opts: { fullReceived: boolean; userEmail?: string },
): Promise<void> {
  const [item] = await tx
    .select()
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.id, itemId))
    .for("update")
  if (!item) throw new Error(`Item ${itemId} not found`)
  await lockRequestsForRollupTx(tx, [item.requestId])

  const allowedFrom: ItemStatus[] = ["purchased", "partially_office_received", "office_received"]
  if (!allowedFrom.includes(item.status as ItemStatus)) {
    throw new Error(`Cannot receive item in office from state '${item.status}'`)
  }

  const targetStatus: ItemStatus = opts.fullReceived ? "office_received" : "partially_office_received"
  const statusChanged = item.status !== targetStatus
  if (statusChanged && !canTransition(item.status as ItemStatus, targetStatus)) {
    throw new Error(`Cannot transition item from '${item.status}' to '${targetStatus}'`)
  }

  if (statusChanged) {
    const now = new Date().toISOString()
    await tx
      .update(purchaseRequestItems)
      .set({ status: targetStatus, updatedAt: now })
      .where(and(eq(purchaseRequestItems.id, itemId), eq(purchaseRequestItems.status, item.status)))

    await recordStatusChange({
      entityType: "request_item",
      entityId: itemId,
      fromStatus: item.status,
      toStatus: targetStatus,
      changedBy: userId,
    }, tx)
  }

  await recordAudit({
    userId,
    userEmail: opts.userEmail,
    action: "status_change",
    entityType: "request_item",
    entityId: itemId,
    oldState: { status: item.status },
    newState: { status: targetStatus, checkpoint: "office" },
  }, tx)

  await rollupRequestStatus(item.requestId, tx, userId)
}

/**
 * Mark an item as delivered to faena (from warehouse dispatch).
 * Transitions received → delivered.
 */
export async function deliverItemTx(
  tx: Tx,
  itemId: string,
  userId: string,
  opts?: { userEmail?: string; deliveredQuantity?: number; totalDelivered?: number },
): Promise<void> {
    // El lock del ítem es el mismo que toma `receiveItemTx` y por el mismo
    // motivo (LOG-6/DAT-1): sin él, una entrega y una recepción concurrentes
    // sobre el MISMO ítem leen el estado obsoleto la una de la otra. Faltaba
    // en esta mitad del par.
    const [item] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.id, itemId))
      .for("update")
    if (!item) throw new Error(`Item ${itemId} not found`)
    await lockRequestsForRollupTx(tx, [item.requestId])

    const targetStatus = getDeliveryTargetStatus(item.quantity, opts?.totalDelivered)

    const statusChanged = item.status !== targetStatus
    if (statusChanged && !canTransition(item.status as ItemStatus, targetStatus)) {
      throw new Error(`Cannot deliver item in state '${item.status}'`)
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseRequestItems)
      .set({ status: targetStatus, updatedAt: now })
      .where(eq(purchaseRequestItems.id, itemId))

    if (statusChanged) {
      await recordStatusChange({
        entityType: "request_item",
        entityId:   itemId,
        fromStatus: item.status,
        toStatus:   targetStatus,
        changedBy:  userId,
      }, tx)
    }
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "request_item",
      entityId:   itemId,
      oldState:   { status: item.status },
      newState:   {
        status: targetStatus,
        deliveredQuantity: opts?.deliveredQuantity,
        totalDelivered: opts?.totalDelivered,
      },
    }, tx)

    await rollupRequestStatus(item.requestId, tx, userId)
}

/**
 * Devuelve un ítem trazable al estado que le corresponde después de anular una
 * entrega.
 *
 * No es una transición del flujo normal —`canTransition` sólo describe avances—
 * sino un reverso explícito, así que el estado no se "recuerda": se recalcula
 * desde los hechos que quedan en pie. Con saldo entregado todavía positivo el
 * ítem queda `partially_delivered`; sin saldo vuelve a `received` o
 * `partially_received` según lo que la faena tenga efectivamente recibido.
 *
 * Recalcular en vez de guardar el estado anterior evita que dos anulaciones
 * seguidas, o una anulación después de una recepción, dejen un estado que ya no
 * corresponde a las cantidades reales.
 */
export async function revertDeliveredItemTx(
  tx: Tx,
  itemId: string,
  userId: string,
  opts: {
    userEmail?: string
    /** Entregado que queda vigente después de descontar la entrega anulada. */
    totalDelivered: number
    /** Recibido en faena, para decidir entre `received` y `partially_received`. */
    receivedAtFaena: number
    reason: string
  },
): Promise<void> {
  const [item] = await tx
    .select()
    .from(purchaseRequestItems)
    .where(eq(purchaseRequestItems.id, itemId))
    .for("update")
  if (!item) throw new Error(`Item ${itemId} not found`)
  await lockRequestsForRollupTx(tx, [item.requestId])

  const targetStatus: ItemStatus = opts.totalDelivered > 0
    ? getDeliveryTargetStatus(item.quantity, opts.totalDelivered)
    : opts.receivedAtFaena >= item.quantity
      ? "received"
      : "partially_received"

  if (item.status === targetStatus) return

  const now = new Date().toISOString()
  const [updated] = await tx
    .update(purchaseRequestItems)
    .set({ status: targetStatus, updatedAt: now })
    .where(and(eq(purchaseRequestItems.id, itemId), eq(purchaseRequestItems.status, item.status)))
    .returning({ id: purchaseRequestItems.id })
  if (!updated) throw new Error("El ítem ya no está disponible: posible concurrencia")

  await recordStatusChange({
    entityType: "request_item",
    entityId:   itemId,
    fromStatus: item.status,
    toStatus:   targetStatus,
    changedBy:  userId,
  }, tx)
  await recordAudit({
    userId,
    userEmail:  opts.userEmail,
    action:     "status_change",
    entityType: "request_item",
    entityId:   itemId,
    oldState:   { status: item.status },
    newState:   { status: targetStatus, totalDelivered: opts.totalDelivered, reason: opts.reason },
  }, tx)

  await rollupRequestStatus(item.requestId, tx, userId)
}

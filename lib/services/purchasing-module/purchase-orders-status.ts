/**
 * Purchase order status transitions: issue+send (fused), cancel.
 * All DB mutations here, never in Server Actions or UI components.
 */

import { eq, and, inArray } from "drizzle-orm"
import { db } from "@/db"
import { purchaseOrders, purchaseOrderItems, purchaseRequestItems, suppliers } from "@/db/schema"
import { recordAudit, recordStatusChange, recordStatusChanges } from "@/lib/audit"
import { lockRequestsForRollupTx, rollupRequestStatus } from "@/lib/services/item-state-module/rollup"
import {
  getActiveOrderedQuantitiesTx,
  lockPurchaseRequestItemsTx,
  PURCHASE_COVERAGE_EPSILON,
} from "./purchasable-coverage"

/* ── Emitir y enviar (draft → sent) ─────────────────────────────────────────────
 * Fusión 2026-08-07: "emitir" y "enviar al proveedor" eran dos pasos (draft →
 * issued → sent); el estado `issued` se retiró. issuedAt/issuedBy y sentAt se
 * registran juntos en la única transición. */

/**
 * OC-002 (auditoría 2026-09-14): constancia de que la OC salió al proveedor.
 *
 * `dispatchEvidence` es lo que el operador declara haber hecho (nº de correo,
 * acuse, "entregada en mano al vendedor"…). No es obligatorio: exigirlo, o
 * partir «Emitir» de «Enviar» en dos estados, es una decisión de producto que
 * la plataforma no declara en ninguna parte. Lo que sí se puede afirmar sin
 * decidir nada es a qué contacto registrado se dirige la orden, y que cuando no
 * hay contacto ni declaración la plataforma NO puede sostener que la compra
 * salió.
 */
export interface OrderDispatchRecord {
  /** Canal de contacto del proveedor vigente al emitir, o null si no hay. */
  sentTo: string | null
  /** Constancia declarada por quien emite, si la aportó. */
  evidence: string | null
  /** False cuando no hay ni contacto registrado ni constancia declarada. */
  hasDispatchEvidence: boolean
  /** Frase que se guarda en historial y auditoría; la usa también el aviso. */
  summary: string
}

export async function issueAndSendOrder(
  orderId: string,
  userId: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string; dispatchEvidence?: string },
): Promise<OrderDispatchRecord> {
  let dispatch!: OrderDispatchRecord
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId)).for("update")
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (order.status !== "draft") {
      throw new Error(`Cannot issue and send order in state '${order.status}'`)
    }

    /*
     * OC-001 (auditoría 2026-09-14): el proveedor activo se exigía sólo al crear
     * el borrador. Entre el borrador y la emisión un administrador puede
     * desactivarlo, y emitir comprometía la compra igual —con recepción, costo y
     * facturación— contra una contraparte que la administración ya retiró.
     *
     * Se lee bajo bloqueo, dentro de la misma transacción que la OC: leerlo sin
     * bloquear dejaría abierta justo la carrera que el hallazgo describe.
     */
    const [supplier] = await tx
      .select({
        id: suppliers.id,
        name: suppliers.name,
        isActive: suppliers.isActive,
        // OC-002: el destinatario se congela al emitir. Si mañana cambia la
        // ficha del proveedor, la traza debe seguir diciendo a dónde se dijo
        // que salió esta orden.
        email: suppliers.email,
        phone: suppliers.phone,
      })
      .from(suppliers)
      .where(eq(suppliers.id, order.supplierId))
      .for("update")
    if (!supplier) {
      throw new Error("El proveedor de esta orden ya no existe: no se puede emitir")
    }
    if (!supplier.isActive) {
      throw new Error(
        `${supplier.name} está desactivado como proveedor: no se puede emitir esta orden. `
        + "Reactívalo o crea la orden con otro proveedor.",
      )
    }

    // A-03: an empty OC must never reach 'sent'. The receipt rollup keys off
    // OC items, so a 0-item order would otherwise sit in 'sent' forever.
    const ocItems = await tx
      .select({ requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))
    if (ocItems.length === 0) {
      throw new Error("No se puede emitir y enviar una orden de compra sin ítems")
    }

    const now = new Date().toISOString()
    await tx
      .update(purchaseOrders)
      .set({ status: "sent", issuedAt: now, issuedBy: userId, sentAt: now, updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    // Move request items to "purchased" status
    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)

    if (requestItemIds.length > 0) {
      // DAT-10: trazar sólo los ítems que la guarda realmente movió — si alguno
      // ya no estaba en 'in_purchase_order' (carrera con otra transición), la
      // guarda del WHERE no lo toca y el historial no debe fingir que sí.
      const updatedItems = await tx
        .update(purchaseRequestItems)
        .set({ status: "purchased", updatedAt: now })
        .where(
          and(
            inArray(purchaseRequestItems.id, requestItemIds),
            eq(purchaseRequestItems.status, "in_purchase_order"),
          )
        )
        .returning({ id: purchaseRequestItems.id })

      await recordStatusChanges(
        updatedItems.map(({ id }) => ({
          entityType: "request_item" as const,
          entityId:   id,
          fromStatus: "in_purchase_order",
          toStatus:   "purchased",
          changedBy:  userId,
        })),
        tx,
      )
    }

    /*
     * OC-002 (auditoría 2026-09-14): «Emitir y enviar» declaraba la compra
     * enviada al proveedor y abría Recepción, pero la transacción sólo movía
     * estados y fechas. No quedaba destinatario, canal ni acuse, así que
     * auditoría no podía distinguir una emisión administrativa de un despacho
     * efectivo, y Recepción podía preparar mercadería de una OC que el
     * proveedor no conocía.
     *
     * La plataforma no despacha por sí misma —no hay integración de correo ni
     * portal—, de modo que lo único honesto que puede registrar es a qué
     * contacto registrado se dirige y qué declara el emisor. Cuando no hay ni
     * lo uno ni lo otro, se deja escrito que la OC se emitió SIN constancia en
     * vez de afirmar un envío que nadie puede sostener.
     *
     * QUEDA POR DECIDIR (producto, no se inventa aquí): si la ausencia de
     * constancia debe bloquear la transición, si Recepción debe esperar al
     * acuse, y cuál es el catálogo de canales válidos con su adjunto
     * obligatorio.
     */
    const evidence = opts?.dispatchEvidence?.trim() || null
    const sentTo = supplier.email?.trim() || supplier.phone?.trim() || null
    const summary = evidence
      ? (sentTo
          ? `Enviada a ${supplier.name} (${sentTo}). Constancia: ${evidence}`
          : `Enviada a ${supplier.name}. Constancia: ${evidence}`)
      : (sentTo
          ? `Emitida hacia ${supplier.name} (${sentTo}); el envío es manual y no se registró constancia`
          : `Emitida sin constancia de envío: ${supplier.name} no tiene contacto registrado`)
    dispatch = { sentTo, evidence, hasDispatchEvidence: evidence !== null, summary }

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: "draft",
      toStatus:   "sent",
      changedBy:  userId,
      reason:     summary,
    }, tx)
    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: "draft" },
      newState:   { status: "sent", sentTo, dispatchEvidence: evidence },
    }, tx)
  })

  return dispatch
}

/* ── Cancel Order (draft/sent → cancelled) ───────────────────────────────────── */

export async function cancelOrder(
  orderId: string,
  userId: string,
  reason: string,
  worksiteIds: string[] | 'all' = 'all',
  opts?: { userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId)).for("update")
    if (!order) throw new Error(`Order ${orderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (!["draft", "sent"].includes(order.status)) {
      throw new Error(`Cannot cancel order in status '${order.status}'`)
    }

    const now = new Date().toISOString()

    // Lock the same source rows as createOrder, in a stable order, before
    // removing coverage. Otherwise a concurrent create could legitimately
    // cover the item and this cancellation would still reopen it afterwards.
    const ocItems = await tx
      .select({ requestItemId: purchaseOrderItems.requestItemId })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const requestItemIds = ocItems
      .map((i) => i.requestItemId)
      .filter((id): id is string => id !== null)
    const lockedRequestItems = await lockPurchaseRequestItemsTx(tx, requestItemIds)
    // DAT-1: los padres, después de sus ítems y antes de devolverlos a la cola.
    await lockRequestsForRollupTx(tx, lockedRequestItems.map((item) => item.requestId))

    await tx
      .update(purchaseOrders)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(purchaseOrders.id, orderId))

    await tx
      .update(purchaseOrderItems)
      .set({ status: "cancelled" })
      .where(eq(purchaseOrderItems.purchaseOrderId, orderId))

    const activeCoverageByRequestItem = await getActiveOrderedQuantitiesTx(
      tx,
      lockedRequestItems.map((item) => item.id),
    )
    const uncoveredRequestItemIds: string[] = []
    for (const item of lockedRequestItems) {
      if ((activeCoverageByRequestItem.get(item.id) ?? 0) <= PURCHASE_COVERAGE_EPSILON) {
        uncoveredRequestItemIds.push(item.id)
      }
    }

    if (uncoveredRequestItemIds.length > 0) {
      const updatedItems = await tx
        .update(purchaseRequestItems)
        .set({ status: "pending_purchase", updatedAt: now })
        .where(
          and(
            inArray(purchaseRequestItems.id, uncoveredRequestItemIds),
            inArray(purchaseRequestItems.status, ["in_purchase_order", "purchased"])
          )
        )
        .returning({ id: purchaseRequestItems.id })
      const updatedIds = new Set(updatedItems.map((item) => item.id))

      await recordStatusChanges(
        lockedRequestItems
          .filter((item) => updatedIds.has(item.id))
          .map((item) => ({
          entityType: "request_item" as const,
          entityId:   item.id,
          fromStatus: item.status,
          toStatus:   "pending_purchase",
          changedBy:  userId,
        })),
        tx,
      )
    }

    const affectedRequestIds = [...new Set(
      lockedRequestItems.map((item) => item.requestId),
    )]
    for (const rid of affectedRequestIds) {
      await rollupRequestStatus(rid, tx, userId)
    }

    await recordStatusChange({
      entityType: "purchase_order",
      entityId:   orderId,
      fromStatus: order.status,
      toStatus:   "cancelled",
      changedBy:  userId,
    }, tx)

    await recordAudit({
      userId,
      userEmail:  opts?.userEmail,
      action:     "status_change",
      entityType: "purchase_order",
      entityId:   orderId,
      entityCode: order.code,
      oldState:   { status: order.status },
      newState:   { status: "cancelled" },
      reason,
    }, tx)
  })
}

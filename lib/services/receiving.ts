/**
 * Receiving service — register receipt of goods from a purchase order.
 * Handles receipt + receipt items + OC quantity updates + item status transitions
 * + worksite stock ingress.
 */

import { eq, and, notInArray, ne } from "drizzle-orm"
import { db } from "@/db"
import {
  receipts, receiptItems,
  purchaseOrders, purchaseOrderItems,
  purchaseRequestItems,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { receiveItemTx } from "./item-state"
import { applyMovementTx } from "./stock"
import { notifyManyUser, notifyAfterCommit } from "./notifications"
import { closeOrderTx } from "./purchasing-module/receiving"

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface ReceiptItemInput {
  purchaseOrderItemId: string
  quantityReceived:    number
  quantityRejected?:   number
  quantityDamaged?:    number
  notes?:              string | null
}

export interface RegisterReceiptInput {
  purchaseOrderId:  string
  receivedBy:       string
  userEmail?:       string
  stage:            "office" | "faena"
  worksiteId?:      string | null
  dispatchGuideNo?: string | null
  notes?:           string | null
  items:            ReceiptItemInput[]
}

/* ── Register receipt ────────────────────────────────────────────────────────── */

export async function registerReceipt(
  input: RegisterReceiptInput,
  worksiteIds: string[] | 'all' = 'all',
): Promise<string> {
  if (input.items.length === 0) {
    throw new Error("At least one received item is required")
  }
  const itemIds = input.items.map((item) => item.purchaseOrderItemId)
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error("Receipt contains duplicated order items")
  }

  const receiptId = nanoid()
  const now       = new Date().toISOString()
  const year      = new Date().getFullYear()

  const code = await db.transaction(async (tx) => {
    // Read order INSIDE the transaction to avoid stale status checks.
    const [order] = await tx.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, input.purchaseOrderId)).for("update")
    if (!order) throw new Error(`Purchase order ${input.purchaseOrderId} not found`)
    if (worksiteIds !== 'all' && !worksiteIds.includes(order.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }
    if (!["sent", "partially_office_received", "office_received", "partially_received"].includes(order.status)) {
      throw new Error(`Cannot receive against order in state '${order.status}'`)
    }
    const directFaena = order.deliveryMode === "directo_faena"
    if (directFaena && input.stage === "office") {
      throw new Error("Esta OC es de despacho directo a faena; no registra llegada a oficina")
    }
    if (!directFaena && input.stage === "faena" && order.status === "sent") {
      throw new Error("Debes registrar primero la llegada a oficina antes de recibir en faena")
    }

    const worksiteId = order.worksiteId
    if (input.worksiteId && input.worksiteId !== worksiteId) {
      throw new Error("La faena de recepción debe coincidir con la OC")
    }
    const txCode = await nextCodeTx(tx, "REC", year)

    await tx.insert(receipts).values({
      id:              receiptId,
      code:            txCode,
      purchaseOrderId: input.purchaseOrderId,
      receivedBy:      input.receivedBy,
      receivedAt:      now,
      locationType:    input.stage,
      worksiteId,
      dispatchGuideNo: input.dispatchGuideNo ?? null,
      status:          "closed",
      notes:           input.notes ?? null,
      createdAt:       now,
    })

    for (const ri of input.items) {
      const qtyRec = ri.quantityReceived
      const qtyRej = ri.quantityRejected ?? 0
      const qtyDmg = ri.quantityDamaged  ?? 0

      // Lock the OC item row to serialize concurrent receipts on the same item.
      const [lockedOcItem] = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.id, ri.purchaseOrderItemId))
        .for("update")

      if (!lockedOcItem || lockedOcItem.purchaseOrderId !== input.purchaseOrderId) {
        throw new Error(`OC item ${ri.purchaseOrderItemId} not in this order`)
      }

      // Office stage caps at the ordered quantity; faena stage caps at what already arrived at
      // office for via_oficina OCs, or directly at the ordered quantity for directo_faena OCs.
      const currentReceived = input.stage === "office"
        ? (lockedOcItem.quantityOfficeReceived ?? 0)
        : (lockedOcItem.quantityReceived ?? 0)
      const dispositionCapacity = input.stage === "office"
        ? lockedOcItem.quantity
        : directFaena
          ? lockedOcItem.quantity
          : (lockedOcItem.quantityOfficeReceived ?? 0)

      if (!Number.isFinite(qtyRec) || qtyRec < 0) {
        throw new Error("Received quantity cannot be negative")
      }
      if (qtyRej < 0 || qtyDmg < 0) {
        throw new Error("Rejected and damaged quantities cannot be negative")
      }
      // M-3: una línea 100% rechazada/dañada llega con qtyRec = 0. Se acepta
      // mientras haya alguna cantidad (recibida, rechazada o dañada); no suma
      // stock ni avanza el ítem de solicitud.
      if (qtyRec + qtyRej + qtyDmg <= 0) {
        throw new Error("Registra al menos una cantidad (recibida, rechazada o dañada)")
      }
      const dispositions = await tx
        .select({
          quantityReceived: receiptItems.quantityReceived,
          quantityRejected: receiptItems.quantityRejected,
          quantityDamaged: receiptItems.quantityDamaged,
        })
        .from(receiptItems)
        .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
        .where(and(
          eq(receiptItems.purchaseOrderItemId, ri.purchaseOrderItemId),
          eq(receipts.locationType, input.stage),
        ))
      const alreadyDisposed = dispositions.reduce(
        (total, disposition) => total
          + disposition.quantityReceived
          + disposition.quantityRejected
          + disposition.quantityDamaged,
        0,
      )
      const requestedDisposition = qtyRec + qtyRej + qtyDmg
      if (requestedDisposition > dispositionCapacity - alreadyDisposed) {
        throw new Error(`La disposición excede el saldo pendiente del ítem ${ri.purchaseOrderItemId} (disposition exceeds pending quantity)`)
      }

      const totalNowReceived = currentReceived + qtyRec
      const lineStatus = qtyRec === 0
        ? (qtyDmg > qtyRej ? "damaged" : "rejected")
        : (totalNowReceived >= lockedOcItem.quantity ? "received" : "partially_received")
      const receiptItemId = nanoid()
      await tx.insert(receiptItems).values({
        id:                  receiptItemId,
        receiptId,
        purchaseOrderItemId: ri.purchaseOrderItemId,
        quantityReceived:    qtyRec,
        quantityRejected:    qtyRej,
        quantityDamaged:     qtyDmg,
        status:              lineStatus,
        notes:               ri.notes ?? null,
      })

      // Sin cantidad buena recibida no hay avance de OC, stock ni ítem: solo queda
      // el registro del rechazo/daño en receiptItems.
      if (qtyRec > 0) {
        await tx
          .update(purchaseOrderItems)
          .set(input.stage === "office"
            ? { quantityOfficeReceived: totalNowReceived }
            : { quantityReceived: totalNowReceived })
          .where(eq(purchaseOrderItems.id, ri.purchaseOrderItemId))

        if (input.stage === "office" && lockedOcItem.requestItemId) {
          const reqItem = await tx.query.purchaseRequestItems.findFirst({
            where: eq(purchaseRequestItems.id, lockedOcItem.requestItemId),
            with: { request: { columns: { requesterId: true, code: true, id: true } } },
          })
          const request = reqItem?.request
          const requesterId = request?.requesterId
          if (requesterId) {
            notifyAfterCommit(() => notifyManyUser([requesterId], {
              type: "receipt_done",
              title: "Pedido recibido en Oficina Chome",
              body: `El ítem de tu solicitud ${request?.code ?? ""} llegó al checkpoint de Oficina Chome y se prepara su traslado a faena.`,
              entityType: "purchase_request",
              entityId: request?.id ?? "",
              entityHref: `/solicitudes/${request?.id ?? ""}`,
            }))
          }
        }

        if (input.stage === "faena" && lockedOcItem.requestItemId) {
          const fullReceived = totalNowReceived >= lockedOcItem.quantity
          await receiveItemTx(tx, lockedOcItem.requestItemId, input.receivedBy, {
            fullReceived,
            userEmail: input.userEmail,
          })

          // F-7: notify the original requester when the item is fully received at faena.
          if (fullReceived) {
            const reqItem = await tx.query.purchaseRequestItems.findFirst({
              where: eq(purchaseRequestItems.id, lockedOcItem.requestItemId),
              with: { request: { columns: { requesterId: true, code: true, id: true } } },
            })
            const requesterId = reqItem?.request?.requesterId
            if (requesterId) {
              notifyAfterCommit(() => notifyManyUser([requesterId], {
                type: "receipt_done",
                title: `Tu pedido llegó a faena`,
                body: `El ítem de tu solicitud ${reqItem?.request?.code ?? ""} fue recepcionado en faena y está disponible para entrega.`,
                entityType: "purchase_request",
                entityId: reqItem?.request?.id ?? "",
                entityHref: `/solicitudes/${reqItem?.request?.id ?? ""}`,
              }))
            }
        }

          if (worksiteId && lockedOcItem.productId) {
            await applyMovementTx(tx, {
              worksiteId,
              productId:   lockedOcItem.productId,
              type:        "ingreso_oc",
              quantity:    qtyRec,
              referenceType: "purchase_order",
              referenceId: input.purchaseOrderId,
              performedBy: input.receivedBy,
              userEmail:   input.userEmail,
              notes:       `Recepción ${txCode} — guía ${input.dispatchGuideNo ?? "s/n"}`,
            })
          }
        }
      }
    }

    const rolledUpStatus = await rollupOrderReceiptStatus(input.purchaseOrderId, tx, order.deliveryMode)

    // Fully received closes the order in the same transaction: there's no separate
    // "receiving in progress" state to sit in once every item has arrived.
    if (rolledUpStatus === "received") {
      await closeOrderTx(
        tx,
        { ...order, status: "received" },
        input.receivedBy,
        "Cierre automático: recepción completa",
        { userEmail: input.userEmail },
      )
    }

    await recordAudit({
      userId:     input.receivedBy,
      userEmail:  input.userEmail,
      action:     "create",
      entityType: "receipt",
      entityId:   receiptId,
      entityCode: txCode,
      newState:   {
        purchaseOrderId: input.purchaseOrderId,
        stage:           input.stage,
        worksiteId,
        itemCount:       input.items.length,
      },
    }, tx)
    return txCode
  })

  void code // used only for audit above; receiptId is returned

  return receiptId
}

/* ── Roll up OC status based on received quantities ────────────────────────────  */

async function rollupOrderReceiptStatus(
  orderId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  deliveryMode: string,
): Promise<string | null> {
  const ocItems = await tx
    .select({
      quantity:               purchaseOrderItems.quantity,
      quantityOfficeReceived: purchaseOrderItems.quantityOfficeReceived,
      quantityReceived:       purchaseOrderItems.quantityReceived,
    })
    .from(purchaseOrderItems)
    .where(and(
      eq(purchaseOrderItems.purchaseOrderId, orderId),
      ne(purchaseOrderItems.status, "cancelled"),
    ))

  if (ocItems.length === 0) return null

  // Deterministic rollup from item quantities. For via_oficina OCs office is always
  // first, so the invariant quantityReceived ≤ quantityOfficeReceived ≤ quantity holds,
  // giving a monotonic chain: sent → partially_office_received → office_received →
  // partially_received → received. directo_faena OCs skip office entirely and derive
  // status from faena quantities alone.
  const allFaena  = ocItems.every((i) => (i.quantityReceived       ?? 0) >= i.quantity)
  const anyFaena  = ocItems.some( (i) => (i.quantityReceived       ?? 0) > 0)

  let newStatus: string
  if (deliveryMode === "directo_faena") {
    // Direct-to-faena OCs never pass through the office checkpoint; status is
    // derived purely from faena-received quantities.
    if (allFaena)      newStatus = "received"
    else if (anyFaena) newStatus = "partially_received"
    else return null
  } else {
    const allOffice = ocItems.every((i) => (i.quantityOfficeReceived ?? 0) >= i.quantity)
    const anyOffice = ocItems.some( (i) => (i.quantityOfficeReceived ?? 0) > 0)
    if (allFaena)        newStatus = "received"
    else if (anyFaena)   newStatus = "partially_received"
    else if (allOffice)  newStatus = "office_received"
    else if (anyOffice)  newStatus = "partially_office_received"
    else return null
  }

  const now = new Date().toISOString()
  await tx
    .update(purchaseOrders)
    .set({ status: newStatus, updatedAt: now })
    // Never pull a manually closed/cancelled order back into the receiving flow.
    .where(and(
      eq(purchaseOrders.id, orderId),
      notInArray(purchaseOrders.status, ["closed", "cancelled"]),
    ))

  return newStatus
}

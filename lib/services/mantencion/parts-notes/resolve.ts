import { asc, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantPartsNoteItems, mantPartsNotes, products } from "@/db/schema"
import { OT_OPEN_STATUSES } from "@/lib/mantencion/work-order-states"
import { roundQty, toCents } from "@/lib/services/stock-reservations"
import { notifyAfterCommit } from "@/lib/services/notification-create"
import { formatQty, requiresWholeQuantity } from "@/lib/utils"
import type { MantViewer } from "../access"
import { addToAllocationTx, freeStockTx, lockForStockTx } from "../parts/allocations"
import type { PartsActionResult } from "../parts/types"
import { assertCanManage, guarded, loadItemContext, loadNoteContext, lockWorkOrdersShare, NOT_FOUND_ITEM, NOT_FOUND_NOTE, NoteRefusal, requireReason, type NoteItemContext } from "./context"
import { loadPurchases } from "./lines"
import { rejectLineTx } from "./line-rejection"
import { notifyPartsNoteItemRejected } from "./notifications"
import { allPurchasesDead, isResolvableLine, recalcNoteStatusTx } from "./status"
import { writeTrail } from "./trail"

/**
 * Resolución de las líneas de una nota de pedido (NP) por jefatura: sacar del stock
 * de la faena, rechazar, anular la NP y dejar «en compra» lo que pide una solicitud.
 * SIEMPRE con `mant:np:manage` y la faena de la NP en el alcance de quien actúa.
 *
 * Bloqueo: la fila de la línea se toma `FOR NO KEY UPDATE` (no choca con las FK de
 * las reservas ni de las solicitudes, que sólo piden `KEY SHARE`). El stock sigue el
 * orden global de `parts/allocations.ts`: OT (`FOR SHARE`) → faena → filas de stock.
 * Rechazar y anular toman la OT `FOR SHARE` antes que la línea o la NP: cerrar o anular
 * la OT (`FOR UPDATE`) rechaza sus líneas pendientes (`line-rejection.ts`) y así no se
 * cruzan. Todo rechazo ocurre antes de escribir. Cada escritura deja evento en la OT,
 * estado de la NP recalculado y auditoría.
 */

const OPEN: readonly string[] = OT_OPEN_STATUSES

/** Por qué una línea ya no se puede resolver, o `null` si sí. Las compras vivas viven fuera de la línea. */
async function whyNotResolvable(tx: Tx, line: NoteItemContext): Promise<string | null> {
  if (line.noteStatus === "anulada") return `La nota ${line.code} está anulada.`
  if (line.resolution === "desde_stock") return `«${line.description}» ya se apartó del stock.`
  if (line.resolution === "rechazada") return `«${line.description}» ya está rechazada.`
  const purchases = [...((await loadPurchases(tx, [line.itemId])).get(line.itemId) ?? [])]
  const liveness = purchases.map((row) => ({ itemStatus: row.status, requestStatus: row.requestStatus }))
  if (isResolvableLine(line.resolution, liveness)) return null
  const request = purchases.find((row) => !allPurchasesDead([{ itemStatus: row.status, requestStatus: row.requestStatus }]))
  return `«${line.description}» ya tiene una compra en curso${request ? ` (solicitud ${request.requestCode})` : ""}.`
}

export async function resolveNoteItemFromStock(viewer: MantViewer, input: { itemId: string; productId: string; quantity: number }): Promise<PartsActionResult> {
  return guarded(async () => {
    const quantity = roundQty(input.quantity)
    if (!Number.isFinite(input.quantity) || toCents(quantity) <= 0) throw new NoteRefusal("La cantidad debe ser mayor que cero.", "quantity")
    const first = await loadItemContext(db, input.itemId)
    if (!first) throw new NoteRefusal(NOT_FOUND_ITEM)
    assertCanManage(viewer, first)

    const [product] = await db
      .select({ name: products.name, unit: products.unitOfMeasure, isSparePart: products.isSparePart, isActive: products.isActive })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1)
    if (!product || !product.isSparePart || !product.isActive) throw new NoteRefusal("Elige un repuesto activo del catálogo de repuestos.", "productId")
    if (requiresWholeQuantity(product.unit) && !Number.isInteger(quantity)) throw new NoteRefusal(`«${product.name}» se maneja en unidades enteras.`, "quantity")
    if (toCents(quantity) > toCents(first.quantity)) throw new NoteRefusal(`La línea pide ${formatQty(first.quantity)}: no puedes sacar más.`, "quantity")

    return db.transaction(async (tx): Promise<PartsActionResult> => {
      const worksiteId = first.vehicleWorksiteId
      if (!viewer.isGlobal && !viewer.worksiteIds.includes(worksiteId)) {
        throw new NoteRefusal(`El equipo está hoy en ${first.vehicleWorksiteName}, que no es de tu alcance: no puedes sacar su stock.`)
      }
      const locks = await lockForStockTx(tx, { workOrderIds: [first.workOrderId], worksiteId, productIds: [input.productId] })
      // Con la línea y el stock bloqueados se vuelve a leer todo: el equipo pudo cambiar de faena o la línea resolverse mientras esperaba.
      const line = await loadItemContext(tx, input.itemId, { lock: true })
      if (!line) throw new NoteRefusal(NOT_FOUND_ITEM)
      if (line.vehicleWorksiteId !== worksiteId) throw new NoteRefusal("El equipo cambió de faena mientras se resolvía la línea. Vuelve a intentarlo.")
      const blocked = await whyNotResolvable(tx, line)
      if (blocked) throw new NoteRefusal(blocked)
      const ot = locks.workOrders.get(line.workOrderId)
      if (!ot || !OPEN.includes(ot.status)) {
        throw new NoteRefusal(`La orden ${line.workOrderFolio} ya está cerrada o anulada: no se reservan repuestos para ella.`)
      }

      const free = await freeStockTx(tx, worksiteId, input.productId)
      if (toCents(quantity) > toCents(free)) throw new NoteRefusal(`En ${line.vehicleWorksiteName} hay ${formatQty(free)} libres.`, "quantity")
      const allocation = await addToAllocationTx(tx, {
        workOrderId: line.workOrderId,
        worksiteId,
        productId: input.productId,
        quantity,
        source: "stock_existente",
        noteItemId: line.itemId,
        actorUserId: viewer.userId,
        userEmail: viewer.email ?? undefined,
        reason: `Nota de pedido ${line.code}`,
      })
      if (!allocation) throw new NoteRefusal(`La orden ${line.workOrderFolio} ya está cerrada o anulada: no se reservan repuestos para ella.`)

      await tx.update(mantPartsNoteItems).set({
        resolution: "desde_stock",
        // Lo que se aparta manda: si la línea traía otro repuesto, el evento deja cuál era.
        productId: input.productId,
        resolutionReason: null,
        resolvedByUserId: viewer.userId,
        resolvedAt: new Date().toISOString(),
      }).where(eq(mantPartsNoteItems.id, line.itemId))
      await recalcNoteStatusTx(tx, line.noteId)
      await writeTrail(tx, {
        workOrderId: line.workOrderId, worksiteId: line.noteWorksiteId, noteId: line.noteId, code: line.code,
        actor: viewer, action: "update",
        oldState: { itemId: line.itemId, resolution: line.resolution },
        changeSet: {
          itemId: line.itemId, resolution: "desde_stock", productId: input.productId, quantity, allocationId: allocation.allocationId,
          ...(line.productId && line.productId !== input.productId ? { previousProductId: line.productId } : {}),
        },
      })
      // Una sola unidad va en singular; cualquier otra cantidad (también 0,5 o 1,5) en plural.
      const reserved = quantity === 1 ? "Se reservó" : "Se reservaron"
      return { ok: true, message: `${reserved} ${formatQty(quantity)} de «${product.name}» del stock de ${line.vehicleWorksiteName} para la orden ${line.workOrderFolio}.` }
    })
  })
}

export async function rejectNoteItem(viewer: MantViewer, input: { itemId: string; reason: string }): Promise<PartsActionResult> {
  // Se arma dentro de la transacción y se envía cuando ya confirmó (un objeto: TS no sigue asignaciones dentro de closures).
  const pending: { notice?: Parameters<typeof notifyPartsNoteItemRejected>[0] } = {}
  const result = await guarded(async () => {
    const reason = requireReason(input.reason, "del rechazo")
    const first = await loadItemContext(db, input.itemId)
    if (!first) throw new NoteRefusal(NOT_FOUND_ITEM)
    assertCanManage(viewer, first)

    return db.transaction(async (tx): Promise<PartsActionResult> => {
      // La OT primero (orden global de bloqueo): cerrarla o anularla rechaza sus líneas pendientes y espera acá, no entre medio.
      await lockWorkOrdersShare(tx, [first.workOrderId])
      const line = await loadItemContext(tx, input.itemId, { lock: true })
      if (!line) throw new NoteRefusal(NOT_FOUND_ITEM)
      const blocked = await whyNotResolvable(tx, line)
      if (blocked) throw new NoteRefusal(blocked)
      await rejectLineTx(tx, line, { reason, actor: viewer })
      pending.notice = {
        noteId: line.noteId, noteItemId: line.itemId, code: line.code, workOrderId: line.workOrderId,
        description: line.description, reason, authorUserId: line.requestedByUserId, actorUserId: viewer.userId,
      }
      return { ok: true, message: `«${line.description}» quedó rechazada.` }
    })
  })
  const { notice } = pending
  if (result.ok && notice) notifyAfterCommit(() => notifyPartsNoteItemRejected(notice))
  return result
}

export async function voidPartsNote(viewer: MantViewer, input: { noteId: string; reason: string }): Promise<PartsActionResult> {
  return guarded(async () => {
    const reason = requireReason(input.reason, "de la anulación")
    const first = await loadNoteContext(db, input.noteId)
    if (!first) throw new NoteRefusal(NOT_FOUND_NOTE)
    assertCanManage(viewer, first)

    return db.transaction(async (tx): Promise<PartsActionResult> => {
      // La OT primero (orden global de bloqueo), como en `rejectNoteItem`.
      await lockWorkOrdersShare(tx, [first.workOrderId])
      const note = await loadNoteContext(tx, input.noteId, { lock: true })
      if (!note) throw new NoteRefusal(NOT_FOUND_NOTE)
      if (note.status === "anulada") throw new NoteRefusal(`La nota ${note.code} ya está anulada.`)
      const items = await tx
        .select({ id: mantPartsNoteItems.id, description: mantPartsNoteItems.description, resolution: mantPartsNoteItems.resolution })
        .from(mantPartsNoteItems)
        .where(eq(mantPartsNoteItems.noteId, note.noteId))
        .orderBy(asc(mantPartsNoteItems.id))
        .for("no key update")
      const purchases = await loadPurchases(tx, items.map((item) => item.id))
      for (const item of items) {
        if (item.resolution === "desde_stock") {
          throw new NoteRefusal(`«${item.description}» ya se apartó del stock de la faena: libera esa reserva antes de anular la nota.`)
        }
        const liveness = (purchases.get(item.id) ?? []).map((row) => ({ itemStatus: row.status, requestStatus: row.requestStatus }))
        if (item.resolution === "en_compra" && !allPurchasesDead(liveness)) {
          throw new NoteRefusal(`«${item.description}» tiene una compra en curso: anula esa solicitud antes de anular la nota.`)
        }
      }
      const now = new Date().toISOString()
      await tx.update(mantPartsNotes).set({
        status: "anulada", voidedByUserId: viewer.userId, voidedAt: now, voidReason: reason, updatedAt: now,
      }).where(eq(mantPartsNotes.id, note.noteId))
      await writeTrail(tx, {
        workOrderId: note.workOrderId, worksiteId: note.worksiteId, noteId: note.noteId, code: note.code,
        actor: viewer, action: "cancel", reason,
        oldState: { status: note.status },
        changeSet: { status: "anulada", reason },
      })
      return { ok: true, message: `La nota ${note.code} quedó anulada.` }
    })
  })
}

export { linkNoteItemsToRequestTx, unlinkNoteItemsFromRequestTx } from "./request-link"

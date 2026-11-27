import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantPartsNoteItems, products } from "@/db/schema"
import { OT_OPEN_STATUSES } from "@/lib/mantencion/work-order-states"
import { roundQty, toCents } from "@/lib/services/stock-reservations"
import { notifyAfterCommit } from "@/lib/services/notification-create"
import { formatQty, requiresWholeQuantity } from "@/lib/utils"
import type { MantViewer } from "../access"
import { addToAllocationTx, freeStockTx, lockForStockTx } from "../parts/allocations"
import type { PartsActionResult } from "../parts/types"
import { assertCanManage, guarded, loadItemContext, lockWorkOrdersShare, NOT_FOUND_ITEM, NoteRefusal, requireReason, type NoteItemContext } from "./context"
import { loadPurchases } from "./lines"
import { rejectLineTx } from "./line-rejection"
import { splitLineRemainderTx } from "./line-split"
import { notifyPartsNoteItemRejected } from "./notifications"
import { allPurchasesDead, isResolvableLine, recalcNoteStatusTx, whyNoteLinesAreLocked } from "./status"
import { writeTrail } from "./trail"

/**
 * Resolución de las líneas de una nota de pedido (NP) por jefatura: sacar del stock
 * de la faena, rechazar y dejar «en compra» lo que pide una solicitud. SIEMPRE con
 * `mant:np:manage` y la faena de la NP en el alcance de quien actúa. La anulación y
 * el resto de transiciones de cabecera viven en `transitions.ts` (y se reexportan aquí).
 *
 * Bloqueo: la fila de la línea se toma `FOR NO KEY UPDATE` (no choca con las FK de
 * las reservas ni de las solicitudes, que sólo piden `KEY SHARE`). El stock sigue el
 * orden global de `parts/allocations.ts`: OT (`FOR SHARE`) → faena → filas de stock.
 * Rechazar toma la OT `FOR SHARE` antes que la línea o la NP: cerrar o anular la OT
 * (`FOR UPDATE`) rechaza sus líneas pendientes (`line-rejection.ts`) y así no se cruzan.
 * Una NP sin OT no tiene OT que tomar (la línea y la NP bastan).
 *
 * Sin OT no hay reserva: «Sacar de bodega» se rechaza (el repuesto ya está libre en la bodega
 * de la faena; se resuelve comprando o rechazando). Con la NP en espera no se resuelve ninguna
 * línea (`whyNotResolvable`): sólo se acepta, se rechaza entera o se anula. Tampoco se resuelve ni se rechaza una línea de una
 * nota cerrada, rechazada o anulada (`whyNoteLinesAreLocked`): sólo «Reabrir» la devuelve a pendiente.
 */

const OPEN: readonly string[] = OT_OPEN_STATUSES

export { voidPartsNote } from "./transitions"

/** Por qué una línea ya no se puede resolver, o `null` si sí. Las compras vivas viven fuera de la línea. */
async function whyNotResolvable(tx: Tx, line: NoteItemContext): Promise<string | null> {
  if (line.noteStatus === "anulada") return whyNoteLinesAreLocked(line.noteStatus, line.code)
  if (line.noteStatus === "en_espera") return "La nota está en espera: acéptala primero."
  if (line.resolution === "desde_stock") return `«${line.description}» ya se apartó del stock.`
  if (line.resolution === "rechazada") return `«${line.description}» ya está rechazada.`
  // Cerrada o rechazada: las líneas que quedan «en compra» sin compra viva (las importadas de CHOME ERP) no se resuelven;
  // sólo «Reabrir» las devuelve. La lectura de la nota la hace el llamador con la línea bloqueada.
  const locked = whyNoteLinesAreLocked(line.noteStatus, line.code)
  if (locked) return locked
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
    const workOrderId = first.workOrderId
    if (!workOrderId) {
      throw new NoteRefusal("Una nota sin OT no aparta stock: el repuesto ya está libre en la bodega de la faena.")
    }

    const [product] = await db
      .select({ name: products.name, unit: products.unitOfMeasure, isSparePart: products.isSparePart, isActive: products.isActive })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1)
    if (!product || !product.isSparePart || !product.isActive) throw new NoteRefusal("Elige un repuesto activo del catálogo de repuestos.", "productId")
    if (requiresWholeQuantity(product.unit) && !Number.isInteger(quantity)) throw new NoteRefusal(`«${product.name}» se maneja en unidades enteras.`, "quantity")
    if (toCents(quantity) > toCents(first.quantity)) throw new NoteRefusal(`La línea pide ${formatQty(first.quantity)}: no puedes sacar más.`, "quantity")

    return db.transaction(async (tx): Promise<PartsActionResult> => {
      const worksiteId = first.stockWorksiteId
      if (!viewer.isGlobal && !viewer.worksiteIds.includes(worksiteId)) {
        throw new NoteRefusal(`El equipo está hoy en ${first.stockWorksiteName}, que no es de tu alcance: no puedes sacar su stock.`)
      }
      const locks = await lockForStockTx(tx, { workOrderIds: [workOrderId], worksiteId, productIds: [input.productId] })
      // Con la línea y el stock bloqueados se vuelve a leer todo: el equipo pudo cambiar de faena o la línea resolverse mientras esperaba.
      const line = await loadItemContext(tx, input.itemId, { lock: true })
      if (!line || !line.workOrderId) throw new NoteRefusal(NOT_FOUND_ITEM)
      if (line.stockWorksiteId !== worksiteId) throw new NoteRefusal("El equipo cambió de faena mientras se resolvía la línea. Vuelve a intentarlo.")
      const blocked = await whyNotResolvable(tx, line)
      if (blocked) throw new NoteRefusal(blocked)
      // Con la línea bloqueada lo pedido es lo que vale: la lectura de arriba pudo quedar vieja.
      if (toCents(quantity) > toCents(line.quantity)) throw new NoteRefusal(`La línea pide ${formatQty(line.quantity)}: no puedes sacar más.`, "quantity")
      const ot = locks.workOrders.get(line.workOrderId)
      if (!ot || !OPEN.includes(ot.status)) {
        throw new NoteRefusal(`La orden ${line.workOrderFolio} ya está cerrada o anulada: no se reservan repuestos para ella.`)
      }

      const free = await freeStockTx(tx, worksiteId, input.productId)
      if (toCents(quantity) > toCents(free)) throw new NoteRefusal(`En ${line.stockWorksiteName} hay ${formatQty(free)} libres.`, "quantity")
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

      // Reservar menos de lo pedido resuelve sólo esa cantidad (NP4-3): lo que falta queda como una línea pendiente nueva
      // de la misma NP, para comprarla, reservarla o rechazarla. La línea conserva lo reservado.
      const split = toCents(quantity) < toCents(line.quantity)
        ? await splitLineRemainderTx(tx, { itemId: line.itemId, keepQuantity: quantity, remainderProductId: line.productId })
        : null
      await tx.update(mantPartsNoteItems).set({
        resolution: "desde_stock",
        // Lo que se aparta manda: si la línea traía otro repuesto, el evento deja cuál era.
        productId: input.productId,
        resolutionReason: null,
        resolvedByUserId: viewer.userId,
        resolvedAt: new Date().toISOString(),
      }).where(eq(mantPartsNoteItems.id, line.itemId))
      await recalcNoteStatusTx(tx, line.noteId, { actorUserId: viewer.userId, itemId: line.itemId })
      await writeTrail(tx, {
        workOrderId: line.workOrderId, worksiteId: line.noteWorksiteId, noteId: line.noteId, code: line.code,
        actor: viewer, action: "update",
        oldState: { itemId: line.itemId, resolution: line.resolution, quantity: line.quantity },
        changeSet: {
          itemId: line.itemId, resolution: "desde_stock", productId: input.productId, quantity, allocationId: allocation.allocationId,
          ...(line.productId && line.productId !== input.productId ? { previousProductId: line.productId } : {}),
          ...(split ? { originalQuantity: split.originalQuantity, remainderItemId: split.remainderItemId, remainderQuantity: split.remainderQuantity } : {}),
        },
      })
      // Una sola unidad va en singular; cualquier otra cantidad (también 0,5 o 1,5) en plural.
      const reserved = quantity === 1 ? "Se reservó" : "Se reservaron"
      const rest = split ? ` El saldo (${formatQty(split.remainderQuantity)}) quedó como una línea pendiente de la nota.` : ""
      return { ok: true, message: `${reserved} ${formatQty(quantity)} de «${product.name}» del stock de ${line.stockWorksiteName} para la orden ${line.workOrderFolio}.${rest}` }
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

export { linkNoteItemsToRequestTx, unlinkNoteItemsFromRequestTx } from "./request-link"

import { asc, eq, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantPartsAllocationSources, mantPartsNoteItems, mantPartsNotes, purchaseRequestItems } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { lockWorkOrdersShare } from "./context"
import { recalcNoteStatusTx } from "./status"

/**
 * Lo que las operaciones de Bodega que DESHACEN o CAMBIAN una llegada hacen con las notas de pedido (NP) de las líneas
 * afectadas (ADR 0001 D19 y D20): anular una recepción, anular una guía y cotejar una guía. Ninguna toca las líneas: la
 * compra sigue viva y volverá a llegar; lo único que cambia es si la nota todavía espera su repuesto, y eso se recalcula en
 * la MISMA transacción, con la misma regla de la llegada (`recalcNoteStatusTx`, D14).
 *
 * Bloqueo: la OT se toma `FOR SHARE` ANTES que el stock (`lockOrdersOfLinesTx`, o `lockForStockTx` con la OT en la lista);
 * la fila de cada NP, la última de todas, `FOR NO KEY UPDATE` y por id. Las llamadas van al FINAL de la transacción de Bodega,
 * después de la orden de compra, para seguir el orden de `registerReceipt` (orden → … → NP) y no cruzarse con una recepción.
 */

export interface NoteStatusChange {
  noteId: string
  code: string
  from: string
  to: string
}

/** Las líneas de nota a las que aportó una recepción o una guía: sus orígenes (aportes y rebajas) llevan `note_item_id`. */
export async function noteItemIdsOfSourceTx(tx: Tx, source: { receiptId: string } | { dispatchGuideId: string }): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ itemId: mantPartsAllocationSources.noteItemId })
    .from(mantPartsAllocationSources)
    .where("receiptId" in source
      ? eq(mantPartsAllocationSources.receiptId, source.receiptId)
      : eq(mantPartsAllocationSources.dispatchGuideId, source.dispatchGuideId))
  return rows.flatMap((row) => (row.itemId ? [row.itemId] : []))
}

/** Las líneas de nota que esos ítems de solicitud compran (`purchase_request_items.parts_note_item_id`). */
export async function noteItemIdsOfRequestItemsTx(tx: Tx, requestItemIds: readonly string[]): Promise<string[]> {
  if (requestItemIds.length === 0) return []
  const rows = await tx
    .select({ itemId: purchaseRequestItems.partsNoteItemId })
    .from(purchaseRequestItems)
    .where(inArray(purchaseRequestItems.id, [...requestItemIds]))
  return rows.flatMap((row) => (row.itemId ? [row.itemId] : []))
}

/** Las NP de esas líneas con su OT, sin repetir y por id. */
async function notesOfLinesTx(tx: Tx, noteItemIds: readonly string[]) {
  if (noteItemIds.length === 0) return []
  return tx
    .selectDistinct({ noteId: mantPartsNotes.id, code: mantPartsNotes.code, worksiteId: mantPartsNotes.worksiteId, workOrderId: mantPartsNotes.workOrderId })
    .from(mantPartsNoteItems)
    .innerJoin(mantPartsNotes, eq(mantPartsNotes.id, mantPartsNoteItems.noteId))
    .where(inArray(mantPartsNoteItems.id, [...noteItemIds]))
    .orderBy(asc(mantPartsNotes.id))
}

/**
 * Toma `FOR SHARE` la OT de esas líneas (primer paso de toda escritura sobre una NP). Para el camino que todavía no ha
 * tomado el stock; el que ya llama a `lockForStockTx` con esas OT no la necesita. Llamarla dos veces es inocuo.
 */
export async function lockOrdersOfLinesTx(tx: Tx, noteItemIds: readonly string[]): Promise<void> {
  const notes = await notesOfLinesTx(tx, noteItemIds)
  await lockWorkOrdersShare(tx, notes.map((note) => note.workOrderId))
}

/**
 * Recalcula el estado de la NP de cada una de esas líneas, sin escribir si no cambia (repetirlo no deja ni un `updated_at`
 * distinto). Con la OT ya tomada. Una NP anulada no se toca. Cada cambio de estado queda en la auditoría de la nota con el
 * motivo (la anulación o el cotejo que lo causó); se devuelve el resumen para la auditoría de quien llama.
 */
export async function recalcNotesOfLinesTx(tx: Tx, input: {
  noteItemIds: readonly string[]
  reason: string
  actorUserId: string
  userEmail?: string
}): Promise<NoteStatusChange[]> {
  const changes: NoteStatusChange[] = []
  for (const note of await notesOfLinesTx(tx, [...new Set(input.noteItemIds)])) {
    // La fila de la NP primero (y antes de leer su estado): dos operaciones sobre la misma nota se serializan aquí.
    const [current] = await tx
      .select({ status: mantPartsNotes.status })
      .from(mantPartsNotes)
      .where(eq(mantPartsNotes.id, note.noteId))
      .limit(1)
      .for("no key update")
    if (!current || current.status === "anulada") continue
    const next = await recalcNoteStatusTx(tx, note.noteId, { onlyIfChanged: true })
    if (next === current.status) continue
    changes.push({ noteId: note.noteId, code: note.code, from: current.status, to: next })
    await recordAudit({
      userId: input.actorUserId,
      userEmail: input.userEmail,
      action: "status_change",
      entityType: "mant_parts_note",
      entityId: note.noteId,
      entityCode: note.code,
      oldState: { status: current.status },
      newState: { status: next },
      reason: input.reason,
      worksiteId: note.worksiteId,
    }, tx)
  }
  return changes
}

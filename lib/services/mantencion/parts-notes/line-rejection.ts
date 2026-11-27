import { and, asc, eq, inArray } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantPartsNoteItems, mantPartsNotes } from "@/db/schema"
import { OPEN_NOTE_STATUSES, recalcNoteStatusTx } from "./status"
import { writeTrail } from "./trail"

/**
 * Rechazar una línea de nota de pedido (NP) dentro de una transacción, y lo que ocurre con las líneas sin
 * resolver cuando su OT termina (NP4-7).
 *
 * - `rejectLineTx` es el paso común: línea `rechazada` con su motivo, estado de la NP recalculado y rastro (evento
 *   `parts_note_resolved` en la OT si la hay, y auditoría de la NP). Lo usa el rechazo de jefatura y el automático.
 *   `skipRecalc` deja el recálculo a quien llama: el rechazo de la nota entera recalcula UNA vez, al final y forzado.
 * - `rejectOpenLinesOfWorkOrderTx` lo llama la transición que cierra (conformidad) o anula la OT, en la MISMA
 *   transacción, con la OT ya bloqueada `FOR UPDATE`: las líneas `pendiente` de las NP abiertas se rechazan solas,
 *   con el motivo, para que la NP no siga en «Pendientes» ni en la cifra del Panel por una orden que ya terminó.
 *   No toca lo ya resuelto (`desde_stock`, `en_compra`, `rechazada`) ni las NP `cerrada`, `rechazada` o `anulada`, y
 *   repetirla no hace nada. No avisa al mecánico: el cierre o la anulación de la OT ya lo avisan. Una NP sin OT nunca
 *   llega aquí (D13 no aplica).
 *
 * Bloqueo: llamar con la OT tomada (`FOR UPDATE` en la transición, `FOR SHARE` en las demás escrituras de la NP). Las
 * filas de las NP y de sus líneas se toman `FOR NO KEY UPDATE` ordenadas por id.
 */

/** Cómo terminó la OT: decide el motivo con que se rechazan sus líneas pendientes. */
export type WorkOrderEnd = { kind: "cerrada" } | { kind: "anulada"; reason: string }

/** La forma en que terminó la OT según su estado; `null` si sigue abierta. `voidReason` es el de la anulación. */
export function workOrderEndOf(status: string, voidReason: string | null): WorkOrderEnd | null {
  if (status === "cerrada") return { kind: "cerrada" }
  if (status === "anulada") return { kind: "anulada", reason: voidReason?.trim() || "sin motivo registrado" }
  return null
}

/** Motivo de una línea rechazada porque su OT terminó: lo que ve jefatura en la NP y el mecánico en su teléfono. */
export function autoRejectionReason(end: WorkOrderEnd): string {
  return end.kind === "cerrada"
    ? "La orden de trabajo se cerró antes de resolver esta línea."
    : `La orden de trabajo se anuló: ${end.reason}`
}

/** Lo que hace falta de una línea para rechazarla (`NoteItemContext` ya lo trae). */
export interface RejectableLine {
  itemId: string
  noteId: string
  code: string
  noteWorksiteId: string
  /** Null: nota sin OT. */
  workOrderId: string | null
  resolution: string
}

/**
 * Deja la línea `rechazada` con su motivo y escribe el rastro; recalcula el estado de su NP salvo `skipRecalc`. La línea ya
 * va bloqueada y comprobada por quien llama. `extra` se suma al `changeSet` del rastro (el automático dice que lo fue y por qué).
 */
export async function rejectLineTx(tx: Tx, line: RejectableLine, input: {
  reason: string
  actor: { userId: string; email?: string | null }
  extra?: Record<string, unknown>
  skipRecalc?: boolean
  /** Lo causó el sistema (la OT que termina, la compra que muere): el evento de la NP queda sin actor humano. */
  automatic?: boolean
}): Promise<void> {
  await tx.update(mantPartsNoteItems).set({
    resolution: "rechazada", resolutionReason: input.reason, resolvedByUserId: input.actor.userId, resolvedAt: new Date().toISOString(),
  }).where(eq(mantPartsNoteItems.id, line.itemId))
  if (!input.skipRecalc) {
    await recalcNoteStatusTx(tx, line.noteId, {
      actorUserId: input.automatic ? null : input.actor.userId,
      reason: input.reason,
      itemId: line.itemId,
    })
  }
  await writeTrail(tx, {
    workOrderId: line.workOrderId, worksiteId: line.noteWorksiteId, noteId: line.noteId, code: line.code,
    actor: input.actor, action: "update", reason: input.reason,
    oldState: { itemId: line.itemId, resolution: line.resolution },
    changeSet: { itemId: line.itemId, resolution: "rechazada", reason: input.reason, ...input.extra },
  })
}

/** Rastro de un rechazo automático: qué lo causó, para distinguirlo del que hace jefatura a mano. */
export const autoRejectionTrail = (end: WorkOrderEnd): Record<string, unknown> => ({
  automatic: true,
  cause: end.kind === "cerrada" ? "ot_cerrada" : "ot_anulada",
})

/**
 * Rechaza las líneas `pendiente` de las NP abiertas de la OT que termina. Devuelve cuántas NP y líneas tocó (`{ notes: 0,
 * lines: 0 }` si no había nada que hacer, que es lo que pasa al repetirla).
 *
 * Además recalcula el estado de esas NP, sin escribir si no cambia: una NP que sólo esperaba una compra deja de esperar
 * cuando la OT termina, porque lo que llegue ya no se reserva para ella (NP4-2). Una NP en espera sigue congelada.
 */
export async function rejectOpenLinesOfWorkOrderTx(tx: Tx, input: {
  workOrderId: string
  actor: { userId: string; email?: string | null }
  end: WorkOrderEnd
}): Promise<{ notes: number; lines: number }> {
  const notes = await tx
    .select({ id: mantPartsNotes.id, code: mantPartsNotes.code, worksiteId: mantPartsNotes.worksiteId })
    .from(mantPartsNotes)
    .where(and(eq(mantPartsNotes.workOrderId, input.workOrderId), inArray(mantPartsNotes.status, [...OPEN_NOTE_STATUSES])))
    .orderBy(asc(mantPartsNotes.id))
    .for("no key update")
  if (notes.length === 0) return { notes: 0, lines: 0 }
  const noteById = new Map(notes.map((note) => [note.id, note]))

  const lines = await tx
    .select({ itemId: mantPartsNoteItems.id, noteId: mantPartsNoteItems.noteId, resolution: mantPartsNoteItems.resolution, sortOrder: mantPartsNoteItems.sortOrder })
    .from(mantPartsNoteItems)
    .where(and(inArray(mantPartsNoteItems.noteId, [...noteById.keys()]), eq(mantPartsNoteItems.resolution, "pendiente")))
    .orderBy(asc(mantPartsNoteItems.id))
    .for("no key update")

  // Las filas se tomaron por id; el rastro sale en el orden de la NP y de la línea, que es como se leen.
  const ordered = [...lines].sort((a, b) => a.noteId.localeCompare(b.noteId) || a.sortOrder - b.sortOrder)
  const reason = autoRejectionReason(input.end)
  const extra = autoRejectionTrail(input.end)
  for (const line of ordered) {
    const note = noteById.get(line.noteId)!
    await rejectLineTx(tx, {
      itemId: line.itemId, noteId: note.id, code: note.code, noteWorksiteId: note.worksiteId,
      workOrderId: input.workOrderId, resolution: line.resolution,
    }, { reason, actor: input.actor, extra, automatic: true })
  }
  // La OT ya figura terminada en esta transacción: una NP con compras en curso pasa de «en gestión» a «cerrada».
  for (const note of notes) await recalcNoteStatusTx(tx, note.id, { onlyIfChanged: true })
  return { notes: new Set(ordered.map((line) => line.noteId)).size, lines: ordered.length }
}

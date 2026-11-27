import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantPartsNoteEvents, mantPartsNotes } from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { PartsNoteStatus } from "../parts/types"

/**
 * Único camino que escribe `mant_parts_notes.status` (ADR 0001, 2026-11-27). Cada cambio deja un evento en
 * `mant_parts_note_events` en la MISMA transacción, de modo que el último evento de una nota siempre dice su estado
 * (invariante que prueban las suites PGlite). Llamarlo con la OT ya tomada (`FOR SHARE`, o `FOR UPDATE` al cerrarla) y
 * antes de tocar la fila de la nota en otro orden: aquí se toma primero la fila de la NP.
 */

export type NoteEventKind = "creada" | "transicion" | "migrada"

export interface SetNoteStatusOptions {
  /** Quién lo cambia. `null` = automático del sistema (una llegada, una recepción, la OT que termina). */
  actorUserId: string | null
  /** Motivo: lo exigen la espera, el rechazo, la anulación y la reapertura. Queda en el evento. */
  reason?: string | null
  /** Línea que causó el cambio, si lo hubo. */
  itemId?: string | null
}

export interface SetNoteStatusResult {
  from: PartsNoteStatus
  to: PartsNoteStatus
  changed: boolean
}

/** Escribe un evento del historial. Sólo lo usan `setNoteStatusTx` y el alta de la NP (`kind: 'creada'`). */
export async function insertNoteEventTx(tx: Tx, input: {
  noteId: string
  kind: NoteEventKind
  fromStatus: PartsNoteStatus | null
  toStatus: PartsNoteStatus
  reason?: string | null
  actorUserId?: string | null
  itemId?: string | null
}): Promise<void> {
  await tx.insert(mantPartsNoteEvents).values({
    id: nanoid(),
    noteId: input.noteId,
    kind: input.kind,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    reason: input.reason ?? null,
    actorUserId: input.actorUserId ?? null,
    itemId: input.itemId ?? null,
  })
}

/**
 * Cambia el estado de la NP si cambia de verdad. Toma la fila de la nota `FOR NO KEY UPDATE`; si el estado ya es `next`,
 * no escribe nada (ni estado, ni `updated_at`, ni evento). Si cambia: estado, `updated_at` y evento `transicion`. Efectos
 * de cabecera que siempre van con el estado:
 *  - `en_espera`: guarda el motivo en `hold_reason`; salir de la espera lo borra (CHECK `mant_parts_notes_hold_valid`).
 *  - `anulada`: guarda quién y cuándo la anuló y el motivo (CHECK `mant_parts_notes_void_valid`).
 */
export async function setNoteStatusTx(tx: Tx, noteId: string, next: PartsNoteStatus, options: SetNoteStatusOptions): Promise<SetNoteStatusResult> {
  const [note] = await tx
    .select({ status: mantPartsNotes.status })
    .from(mantPartsNotes)
    .where(eq(mantPartsNotes.id, noteId))
    .limit(1)
    .for("no key update")
  if (!note) throw new Error("La nota de pedido no existe")
  const from = note.status as PartsNoteStatus
  if (from === next) return { from, to: next, changed: false }

  const now = new Date().toISOString()
  const reason = options.reason?.trim() || null
  if (next === "anulada" && (!options.actorUserId || !reason)) {
    throw new Error("Anular una nota exige quién la anula y el motivo")
  }
  await tx.update(mantPartsNotes).set({
    status: next,
    updatedAt: now,
    holdReason: next === "en_espera" ? reason : null,
    ...(next === "anulada" ? { voidedByUserId: options.actorUserId, voidedAt: now, voidReason: reason } : {}),
  }).where(eq(mantPartsNotes.id, noteId))
  await insertNoteEventTx(tx, {
    noteId,
    kind: "transicion",
    fromStatus: from,
    toStatus: next,
    reason,
    actorUserId: options.actorUserId,
    itemId: options.itemId ?? null,
  })
  return { from, to: next, changed: true }
}

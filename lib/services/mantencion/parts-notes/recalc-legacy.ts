import { and, asc, isNull, ne } from "drizzle-orm"
import type { DB, Tx } from "@/db"
import { mantPartsNotes } from "@/db/schema"
import { lockWorkOrdersShare } from "./context"
import { recalcNoteStatusTx } from "./status"

/**
 * Recálculo único de las notas de pedido (NP) anteriores a la migración 0405 (ADR 0001, 2026-11-27). Esa migración sumó los
 * estados `aceptada` y `recibida_parcial`, pero NO recalcula las notas que ya existían: una nota que hoy dice «en compra»
 * aunque ya llegó parte de lo pedido sigue así hasta que algo la toque. Esto la lleva al estado que corresponde a sus líneas.
 *
 * Alcance: las notas de la plataforma (no las importadas de CHOME ERP, que traen su estado de origen en `external_ref`) y no
 * anuladas. Cada cambio queda en el historial con `actor` null (automático) y `LEGACY_RECALC_REASON`. Es idempotente: sólo
 * escribe donde el estado cambia, así que una segunda corrida no toca nada. La corre `scripts/np-recalcular-estados.ts`, a
 * mano, DESPUÉS del despliegue (ver el ADR).
 *
 * Simulación (`apply: false`): corre el mismo código en una transacción y la deshace, así que el resumen es el de verdad.
 */

export const LEGACY_RECALC_REASON = "Recálculo por estados nuevos (0405)"

export interface LegacyRecalcChange { noteId: string; code: string; from: string; to: string }
export interface LegacyRecalcResult {
  /** Notas revisadas. */
  total: number
  changed: LegacyRecalcChange[]
  applied: boolean
}

class DryRunRollback extends Error {}

type Candidate = { id: string; code: string; status: string; workOrderId: string | null }
async function recalcOne(tx: Tx, note: Candidate): Promise<LegacyRecalcChange | null> {
  // Mismo orden de bloqueo que el resto de las escrituras de la NP: la OT `FOR SHARE` y luego la fila de la nota.
  await lockWorkOrdersShare(tx, [note.workOrderId])
  const next = await recalcNoteStatusTx(tx, note.id, { onlyIfChanged: true, actorUserId: null, reason: LEGACY_RECALC_REASON })
  return next === note.status ? null : { noteId: note.id, code: note.code, from: note.status, to: next }
}

export async function recalcLegacyNoteStatuses(client: DB, options: { apply: boolean }): Promise<LegacyRecalcResult> {
  const notes: Candidate[] = await client
    .select({ id: mantPartsNotes.id, code: mantPartsNotes.code, status: mantPartsNotes.status, workOrderId: mantPartsNotes.workOrderId })
    .from(mantPartsNotes)
    .where(and(isNull(mantPartsNotes.externalRef), ne(mantPartsNotes.status, "anulada")))
    .orderBy(asc(mantPartsNotes.id))

  const changed: LegacyRecalcChange[] = []
  if (options.apply) {
    // Una transacción por nota: una que falle no deshace las demás y se puede volver a correr.
    for (const note of notes) {
      const change = await client.transaction((tx) => recalcOne(tx, note))
      if (change) changed.push(change)
    }
    return { total: notes.length, changed, applied: true }
  }
  try {
    await client.transaction(async (tx) => {
      for (const note of notes) {
        const change = await recalcOne(tx, note)
        if (change) changed.push(change)
      }
      throw new DryRunRollback()
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
  return { total: notes.length, changed, applied: false }
}

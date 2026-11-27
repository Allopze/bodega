import { eq, sql } from "drizzle-orm"
import type { DB, Tx } from "@/db"
import { mantPartsNoteEvents, mantPartsNoteItems, mantPartsNotes } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nextCodeTx } from "@/lib/code-sequences"
import { nanoid } from "@/lib/id"
import type { ExistingNote, PlannedNote } from "./types"

/**
 * Escribe lo que `plan.ts` decidió. UNA transacción por nota (lo que falla no arrastra a las demás) bajo un lock común, de
 * modo que dos corridas simultáneas no se pisan; la idempotencia es por `external_ref` (índice único + lectura bajo el lock).
 *
 * Qué NO hace, a propósito:
 *  - No pasa por `setNoteStatusTx` ni recalcula nada: el estado importado se escribe tal cual y el ÚNICO evento es
 *    `migrada` (to_status = estado, `created_at` = fecha de la nota, sin actor), que cumple la invariante «estado = último
 *    evento».
 *  - No mueve stock, no reserva, no crea eventos de OT: las notas importadas no tienen OT.
 *  - No crea productos ni proveedores.
 */

export interface ImportActor { userId: string; email: string | null }
export interface AppliedNote { externalRef: string; noteId: string; code: string; status: string; lines: number }
export interface FailedNote { externalRef: string; error: string }
export interface ApplyResult {
  applied: AppliedNote[]
  /** Otra corrida la escribió entre la simulación y esta transacción: se salta, no se duplica. */
  alreadyThere: ExistingNote[]
  failed: FailedNote[]
}

const IMPORT_LOCK = "mant-parts-note-import"

async function writeNoteTx(tx: Tx, note: PlannedNote, actor: ImportActor): Promise<AppliedNote | ExistingNote> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${IMPORT_LOCK}))`)
  const [existing] = await tx
    .select({ code: mantPartsNotes.code, status: mantPartsNotes.status })
    .from(mantPartsNotes)
    .where(eq(mantPartsNotes.externalRef, note.externalRef))
    .limit(1)
  if (existing) return { externalRef: note.externalRef, code: existing.code, status: existing.status }

  const noteId = nanoid()
  const code = await nextCodeTx(tx, "NP", note.folioYear)
  await tx.insert(mantPartsNotes).values({
    id: noteId,
    code,
    workOrderId: null,
    vehicleId: null,
    worksiteId: note.worksiteId,
    requestedByUserId: note.requestedByUserId,
    requestedByName: note.requestedByName,
    externalRef: note.externalRef,
    equipmentStopped: false,
    urgent: note.urgent,
    notes: note.notes,
    status: note.status,
    holdReason: note.holdReason,
    createdAt: note.createdAt,
    updatedAt: note.createdAt,
  })
  await tx.insert(mantPartsNoteItems).values(note.lines.map((line) => ({
    id: nanoid(),
    noteId,
    description: line.description,
    quantity: line.quantity,
    unitOfMeasure: line.unitOfMeasure,
    partNumber: line.partNumber,
    productId: line.productId,
    chargeVehicleId: line.chargeVehicleId,
    chargeCostCenterId: line.chargeCostCenterId,
    chargeText: line.chargeText,
    suggestedSupplierId: line.suggestedSupplierId,
    supplierHint: line.supplierHint,
    resolution: line.resolution,
    resolutionReason: line.resolutionReason,
    // El CHECK exige quién y cuándo resolvió toda línea que no está pendiente: la importación a nombre de quien la corre.
    resolvedByUserId: line.resolution === "pendiente" ? null : actor.userId,
    resolvedAt: line.resolution === "pendiente" ? null : note.createdAt,
    sortOrder: line.sortOrder,
    createdAt: note.createdAt,
  })))
  await tx.insert(mantPartsNoteEvents).values({
    id: nanoid(),
    noteId,
    kind: "migrada",
    fromStatus: null,
    toStatus: note.status,
    reason: `Migrada desde CHOME ERP (${note.externalRef})`,
    actorUserId: null,
    itemId: null,
    createdAt: note.createdAt,
  })
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "create",
    entityType: "mant_parts_note",
    entityId: noteId,
    entityCode: code,
    newState: { external_ref: note.externalRef, source: "chome-erp", status: note.status, lines: note.lines.length, urgent: note.urgent, requestedByUserId: note.requestedByUserId },
    worksiteId: note.worksiteId,
  }, tx)
  return { externalRef: note.externalRef, noteId, code, status: note.status, lines: note.lines.length }
}

export async function applyPlannedNotes(client: DB, notes: readonly PlannedNote[], actor: ImportActor): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], alreadyThere: [], failed: [] }
  for (const note of notes) {
    try {
      const written = await client.transaction((tx) => writeNoteTx(tx, note, actor))
      if ("noteId" in written) result.applied.push(written)
      else result.alreadyThere.push(written)
    } catch (error) {
      // Drizzle envuelve el error del motor: el texto útil (el CHECK o el índice que falló) viene en `cause`.
      const cause = (error as { cause?: { message?: string } }).cause?.message
      result.failed.push({ externalRef: note.externalRef, error: cause ?? (error instanceof Error ? error.message : String(error)) })
    }
  }
  return result
}

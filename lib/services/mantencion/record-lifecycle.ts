import { and, eq, isNull, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantRecordObservations, mantRecords, mantRecordVoids, mantWorkOrders } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { createMantencionFilePath, resolveMantencionFile } from "@/lib/storage/config"
import { removeFile } from "@/lib/storage/helpers"
import { REASON_MAX_LENGTH, REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"
import { canObserveRecord, canSeeRecord, hasMantPermission, recordVisibility, type MantViewer } from "./access"
import { pdfRevision, pdfStorageName } from "./record-pdf"
import type { MantActionResult } from "./result"

/**
 * Ciclo de vida de un registro firmado (reglas 13 y 14): anular, observar,
 * marcar revisado y responder una observación.
 *
 * Un registro firmado NO se edita: aquí sólo cambian `status` (anulación) y
 * `review`, más las filas hijas de anulación y observación. Cada operación
 * valida permiso y alcance en el servidor y deja su rastro en la bitácora.
 * Quien llama (la server action de jefatura, el endpoint de sync) sólo reenvía:
 * ocultar un botón nunca es el control.
 */

const NOT_FOUND = "No encontramos ese registro."

interface LockedRecord {
  id: string
  folio: string | null
  status: string
  review: string
  worksiteId: string
  registeredBy: string
  executorUserId: string | null
  /** OT a la que el registro da el trabajo (regla del enlace registro ↔ OT). */
  workOrderId: string | null
  /** PDF archivado de la revisión vigente (su nombre puede llevar huella). */
  pdfStorageKey: string | null
}

async function lockRecord(tx: Tx, recordId: string): Promise<LockedRecord | null> {
  const [row] = await tx
    .select({
      id: mantRecords.id,
      folio: mantRecords.folio,
      status: mantRecords.status,
      review: mantRecords.review,
      worksiteId: mantRecords.worksiteId,
      registeredBy: mantRecords.registeredBy,
      executorUserId: mantRecords.executorUserId,
      workOrderId: mantRecords.workOrderId,
      pdfStorageKey: mantRecords.pdfStorageKey,
    })
    .from(mantRecords)
    .where(eq(mantRecords.id, recordId))
    .for("update")
    .limit(1)
  return row ?? null
}

const label = (record: LockedRecord) => record.folio ?? "sin folio"

/** Estados en los que la OT ya salió de taller: su trabajo quedó firmado, recibido o cerrado. */
const OUT_OF_WORKSHOP = ["trabajo_terminado", "recepcionada", "cerrada"] as const

/**
 * Bloquea la OT del registro y rechaza la anulación si ya salió de taller (hallazgo
 * 3.2): anular el único trabajo vigente dejaría la OT —y su conformidad, su CAPA y la
 * hoja de vida— acreditando una reparación que ya no existe. En `en_ejecucion` sigue
 * permitido: la OT tiene que volver a taller de todos modos.
 *
 * ORDEN DE BLOQUEO: registro → OT. No hay ciclo con el orden equipo → OT de `runLocked`
 * y `createRecord` porque aquí no se bloquea el equipo, y ningún camino bloquea una OT
 * y después un registro (`linkedRecordState` lee sin `FOR UPDATE`).
 */
async function assertWorkOrderInWorkshop(tx: Tx, record: LockedRecord): Promise<MantActionResult | null> {
  if (!record.workOrderId) return null
  const [ot] = await tx
    .select({ folio: mantWorkOrders.folio, status: mantWorkOrders.status })
    .from(mantWorkOrders)
    .where(eq(mantWorkOrders.id, record.workOrderId))
    .for("update")
    .limit(1)
  // Sin OT legible (no debería: la FK la sostiene) o todavía en taller: la anulación sigue.
  if (!ot || !(OUT_OF_WORKSHOP as readonly string[]).includes(ot.status)) return null
  return { ok: false, message: `La OT ${ot.folio} ya salió de taller: reábrela antes de anular ${label(record)}.` }
}

/** Anular (regla 13): sólo jefatura, con motivo; el registro sigue visible y se excluye de lecturas y estados. */
export async function voidRecord(input: { recordId: string; reason: string; viewer: MantViewer }): Promise<MantActionResult> {
  const { viewer } = input
  if (!hasMantPermission(viewer, "mant:records:void")) return { ok: false, message: "No tienes permiso para anular registros." }
  const reason = input.reason.trim()
  if (reason.length < REASON_MIN_LENGTH) return { ok: false, field: "reason", message: `Escribe el motivo de la anulación (al menos ${REASON_MIN_LENGTH} caracteres).` }
  if (reason.length > REASON_MAX_LENGTH) return { ok: false, field: "reason", message: `El motivo es demasiado largo (máximo ${REASON_MAX_LENGTH} caracteres).` }

  return db.transaction(async (tx): Promise<MantActionResult> => {
    const record = await lockRecord(tx, input.recordId)
    if (!record || !canSeeRecord(recordVisibility(viewer), record)) return { ok: false, message: NOT_FOUND }
    if (record.status === "anulado") return { ok: false, message: `El registro ${label(record)} ya estaba anulado.` }
    // Antes de insertar nada: si la OT ya salió de taller, no se anula (ni anulación ni bitácora).
    const blocked = await assertWorkOrderInWorkshop(tx, record)
    if (blocked) return blocked

    await tx.insert(mantRecordVoids).values({ id: nanoid(), recordId: record.id, reason, userId: viewer.userId })
    await tx.update(mantRecords).set({
      status: "anulado",
      // El PDF archivado dejó de ser fiel: se regenera con la marca «ANULADO» (§12).
      pdfStorageKey: null,
      pdfGeneratedAt: null,
      updatedAt: sql`now()`,
    }).where(eq(mantRecords.id, record.id))
    // El archivo de la revisión que acaba de dejar de valer se borra: la fila ya no lo
    // nombra y el próximo «ANULADO» se archiva con otro nombre. Best effort: si no está
    // (o falla el borrado), la descarga lo regenera igual.
    // Se borra el que la fila nombraba (puede llevar huella) y, por si acaso, el nombre sin huella.
    const plainKey = createMantencionFilePath(pdfStorageName(record.id, pdfRevision(record.status)))
    for (const key of [record.pdfStorageKey, plainKey]) {
      const archivedPdf = key ? resolveMantencionFile(key) : null
      if (archivedPdf) await removeFile(archivedPdf).catch(() => undefined)
    }
    await recordAudit({
      userId: viewer.userId,
      userEmail: viewer.email ?? undefined,
      action: "cancel",
      entityType: "mant_record",
      entityId: record.id,
      entityCode: record.folio ?? undefined,
      worksiteId: record.worksiteId,
      oldState: { status: "vigente", review: record.review },
      newState: { status: "anulado" },
      reason,
    }, tx)
    return { ok: true, message: `Registro ${label(record)} anulado.` }
  })
}

/** Observar (regla 14): supervisión en su faena, jefatura en todo su alcance. El registro queda «observado». */
export async function observeRecord(input: { recordId: string; text: string; viewer: MantViewer }): Promise<MantActionResult> {
  const { viewer } = input
  if (!hasMantPermission(viewer, "mant:records:observe")) return { ok: false, message: "No tienes permiso para observar registros." }
  const text = input.text.trim()
  if (text.length < 3) return { ok: false, field: "text", message: "Escribe la observación (al menos 3 letras)." }
  if (text.length > 2000) return { ok: false, field: "text", message: "La observación es demasiado larga (máximo 2.000 letras)." }

  return db.transaction(async (tx): Promise<MantActionResult> => {
    const record = await lockRecord(tx, input.recordId)
    // Observar exige además poder LEER el registro, como anular o marcar revisado (auditoría 2026-11-11).
    if (!record || !canObserveRecord(viewer, record) || !canSeeRecord(recordVisibility(viewer), record)) return { ok: false, message: NOT_FOUND }
    if (record.status === "anulado") return { ok: false, message: `El registro ${label(record)} está anulado: ya no admite observaciones.` }

    await tx.insert(mantRecordObservations).values({ id: nanoid(), recordId: record.id, text, userId: viewer.userId })
    await tx.update(mantRecords).set({ review: "observado", updatedAt: sql`now()` }).where(eq(mantRecords.id, record.id))
    await recordAudit({
      userId: viewer.userId,
      userEmail: viewer.email ?? undefined,
      action: "update",
      entityType: "mant_record",
      entityId: record.id,
      entityCode: record.folio ?? undefined,
      worksiteId: record.worksiteId,
      oldState: { review: record.review },
      newState: { review: "observado", observation: text },
      reason: text,
    }, tx)
    return { ok: true, message: `Observación enviada al mecánico (${label(record)}).` }
  })
}

/** Revisar (regla 14): jefatura marca el registro como «revisado». */
export async function markRecordReviewed(input: { recordId: string; viewer: MantViewer }): Promise<MantActionResult> {
  const { viewer } = input
  if (!hasMantPermission(viewer, "mant:records:review")) return { ok: false, message: "No tienes permiso para marcar registros como revisados." }

  return db.transaction(async (tx): Promise<MantActionResult> => {
    const record = await lockRecord(tx, input.recordId)
    if (!record || !canSeeRecord(recordVisibility(viewer), record)) return { ok: false, message: NOT_FOUND }
    if (record.status === "anulado") return { ok: false, message: `El registro ${label(record)} está anulado.` }
    if (record.review === "revisado") return { ok: true, message: `El registro ${label(record)} ya estaba revisado.` }

    await tx.update(mantRecords).set({ review: "revisado", updatedAt: sql`now()` }).where(eq(mantRecords.id, record.id))
    await recordAudit({
      userId: viewer.userId,
      userEmail: viewer.email ?? undefined,
      action: "update",
      entityType: "mant_record",
      entityId: record.id,
      entityCode: record.folio ?? undefined,
      worksiteId: record.worksiteId,
      oldState: { review: record.review },
      newState: { review: "revisado" },
    }, tx)
    return { ok: true, message: `Registro ${label(record)} marcado como revisado.` }
  })
}

/**
 * Responder una observación (regla 14): sólo quien registró o ejecutó el
 * trabajo, y una sola vez. La respuesta queda en la bitácora; el estado de
 * revisión no cambia: lo cierra jefatura con «revisado».
 */
export async function replyObservation(input: { observationId: string; response: string; userId: string }): Promise<MantActionResult> {
  const response = input.response.trim()
  if (response.length < 2) return { ok: false, field: "response", message: "Escribe tu respuesta." }
  if (response.length > 2000) return { ok: false, field: "response", message: "La respuesta es demasiado larga (máximo 2.000 letras)." }

  return db.transaction(async (tx): Promise<MantActionResult> => {
    const [observation] = await tx
      .select({
        id: mantRecordObservations.id,
        recordId: mantRecordObservations.recordId,
        response: mantRecordObservations.response,
        respondedBy: mantRecordObservations.respondedBy,
      })
      .from(mantRecordObservations)
      .where(eq(mantRecordObservations.id, input.observationId))
      .for("update")
      .limit(1)
    const record = observation ? await lockRecord(tx, observation.recordId) : null
    const mine = !!record && (record.registeredBy === input.userId || record.executorUserId === input.userId)
    if (!observation || !record || !mine) return { ok: false, message: "No encontramos esa observación." }
    // Reintento de la misma respuesta (se perdió la confirmación): no es un error, es el mismo envío.
    if (observation.response === response && observation.respondedBy === input.userId) return { ok: true, message: "Respuesta enviada." }
    if (observation.response !== null) return { ok: false, message: "Esa observación ya tiene respuesta." }

    const [updated] = await tx
      .update(mantRecordObservations)
      .set({ response, respondedBy: input.userId, respondedAt: sql`now()` })
      .where(and(eq(mantRecordObservations.id, observation.id), isNull(mantRecordObservations.response)))
      .returning({ id: mantRecordObservations.id })
    if (!updated) return { ok: false, message: "Esa observación ya tiene respuesta." }
    await recordAudit({
      userId: input.userId,
      action: "update",
      entityType: "mant_record_observation",
      entityId: observation.id,
      entityCode: record.folio ?? undefined,
      worksiteId: record.worksiteId,
      oldState: { response: null },
      newState: { response },
    }, tx)
    return { ok: true, message: "Respuesta enviada." }
  })
}

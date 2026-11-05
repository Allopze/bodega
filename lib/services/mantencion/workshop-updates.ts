import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantRecordCorrectives, mantRecords, mantWorkOrders, mantWorkshopUpdates } from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import { recordAudit } from "@/lib/audit"
import type { SyncWorkshopResponse, WorkshopUpdatePayload } from "@/lib/mantencion/contracts"
import { formatDate, todayInChile } from "@/lib/utils"
import { canSeeRecord, recordVisibility } from "./access"
import type { SyncContext } from "./sync-auth"

/**
 * Actualización del estado de un equipo en taller (regla 11), enviada desde el
 * teléfono: «Sigue en taller» (con nota) o «Ya salió» (con fecha). Idempotente
 * por `id`. NO toca el registro firmado: el estado de taller se deriva de esta
 * tabla (`loadFleet`), así que el documento firmado permanece intacto.
 */

export interface WorkshopOutcome {
  status: 200 | 409 | 422
  body: SyncWorkshopResponse
}

type Existing = { id: string; userId: string; receivedAt: string }
type Reader = Pick<Tx, "select">

/** Tolerancia de reloj del teléfono: la misma que `work-orders/core.ts` para sus fechas. */
const FUTURE_TOLERANCE_MS = 5 * 60_000

const toIso = (value: string) => new Date(value).toISOString()
const refuse = (status: 409 | 422, message: string): WorkshopOutcome => ({ status, body: { ok: false, code: "rejected", message } })

async function findUpdate(client: Reader, id: string): Promise<Existing | null> {
  const [row] = await client
    .select({ id: mantWorkshopUpdates.id, userId: mantWorkshopUpdates.userId, receivedAt: mantWorkshopUpdates.receivedAt })
    .from(mantWorkshopUpdates)
    .where(eq(mantWorkshopUpdates.id, id))
    .limit(1)
  return row ?? null
}

function existingOutcome(existing: Existing, userId: string): WorkshopOutcome {
  if (existing.userId !== userId) return refuse(409, "Ese identificador de actualización ya pertenece a otra persona.")
  return { status: 200, body: { ok: true, id: existing.id, receivedAt: toIso(existing.receivedAt), duplicate: true } }
}

/**
 * La fecha la manda el teléfono: sin cota, una tablet adelantada dejaba el equipo
 * «actualizado» para siempre y una atrasada, «sin actualizar» para siempre. Se
 * tolera el desfase de reloj habitual y nunca se acepta antes del ingreso a taller.
 */
function checkCreatedAt(createdAt: string, entryDate: string | null): WorkshopOutcome | null {
  const when = new Date(createdAt)
  if (Number.isNaN(when.getTime())) return refuse(422, "La fecha de la actualización no es válida.")
  if (when.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    return refuse(422, "La fecha de la actualización no puede ser futura: revisa el reloj del teléfono.")
  }
  // `entryDate` es una fecha civil chilena; el instante se compara en ese mismo calendario.
  if (entryDate && todayInChile(when) < entryDate) {
    return refuse(422, `La fecha de la actualización no puede ser anterior al ingreso a taller (${formatDate(entryDate)}).`)
  }
  return null
}

export async function applyWorkshopUpdate(input: WorkshopUpdatePayload, context: SyncContext): Promise<WorkshopOutcome> {
  const { viewer } = context
  const already = await findUpdate(db, input.id)
  if (already) return existingOutcome(already, viewer.userId)

  try {
    return await db.transaction(async (tx): Promise<WorkshopOutcome> => {
      // Se bloquea el registro: dos «Ya salió» simultáneos no pueden entrar los dos.
      const locked = await tx.select({ id: mantRecords.id }).from(mantRecords).where(eq(mantRecords.id, input.recordId)).for("update")
      if (locked.length === 0) {
        // Un cliente con caché vieja puede mandar el id de la OT que retiene el equipo:
        // el taller lo mueven las transiciones de la OT, no «Sigue/Ya salió».
        const [ot] = await tx.select({ id: mantWorkOrders.id }).from(mantWorkOrders).where(eq(mantWorkOrders.id, input.recordId)).limit(1)
        return ot
          ? refuse(422, "El taller de este equipo lo controla su OT: ábrela desde la app y usa sus acciones.")
          : refuse(422, "Ese registro no existe.")
      }
      const raced = await findUpdate(tx, input.id)
      if (raced) return existingOutcome(raced, viewer.userId)

      const [record] = await tx
        .select({
          folio: mantRecords.folio,
          kind: mantRecords.kind,
          status: mantRecords.status,
          worksiteId: mantRecords.worksiteId,
          registeredBy: mantRecords.registeredBy,
          executorUserId: mantRecords.executorUserId,
          inWorkshop: mantRecordCorrectives.inWorkshop,
          entryDate: mantRecordCorrectives.workshopEntryDate,
        })
        .from(mantRecords)
        .leftJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
        .where(eq(mantRecords.id, input.recordId))
        .limit(1)
      if (!record) return refuse(422, "Ese registro no existe.")
      if (record.status !== "vigente") return refuse(422, "Ese registro está anulado: no admite actualizaciones.")
      if (record.kind !== "C" || !record.inWorkshop) return refuse(422, "Ese registro no dejó el equipo en taller.")

      // Mismo criterio que la LECTURA de registros: quien no puede ver el registro
      // tampoco cierra su taller. La rama de faena sin `view_worksite` dejaba a un
      // mecánico de la faena sacar de taller correctivas ajenas que no podía leer.
      if (!canSeeRecord(recordVisibility(viewer), record)) {
        return refuse(422, "Ese equipo no es de tu faena: no puedes actualizar su estado en taller.")
      }

      const updates = await tx
        .select({ kind: mantWorkshopUpdates.kind, exitDate: mantWorkshopUpdates.exitDate })
        .from(mantWorkshopUpdates)
        .where(eq(mantWorkshopUpdates.recordId, input.recordId))
      const exit = updates.find((update) => update.kind === "salio")
      if (exit) {
        return refuse(409, `El equipo ya salió de taller${exit.exitDate ? ` el ${formatDate(exit.exitDate)}` : ""}: no se aceptan más actualizaciones.`)
      }

      if (input.kind === "salio") {
        if (input.exitDate > todayInChile()) return refuse(422, "La fecha de salida no puede ser futura.")
        if (record.entryDate && input.exitDate < record.entryDate) {
          return refuse(422, `La fecha de salida no puede ser anterior al ingreso (${formatDate(record.entryDate)}).`)
        }
      }

      const dateFailure = checkCreatedAt(input.createdAt, record.entryDate)
      if (dateFailure) return dateFailure

      const [created] = await tx.insert(mantWorkshopUpdates).values({
        id: input.id,
        recordId: input.recordId,
        kind: input.kind,
        note: input.kind === "sigue" ? input.note : null,
        exitDate: input.kind === "salio" ? input.exitDate : null,
        userId: viewer.userId,
        deviceId: context.deviceId,
        createdAt: input.createdAt,
      }).returning({ receivedAt: mantWorkshopUpdates.receivedAt })
      if (!created) throw new Error("No se pudo guardar la actualización de taller")

      await recordAudit({
        userId: viewer.userId,
        userEmail: viewer.email ?? undefined,
        action: "create",
        entityType: "mant_workshop_update",
        entityId: input.id,
        entityCode: record.folio ?? undefined,
        worksiteId: record.worksiteId,
        newState: input.kind === "sigue"
          ? { recordId: input.recordId, kind: input.kind, note: input.note }
          : { recordId: input.recordId, kind: input.kind, exitDate: input.exitDate },
      }, tx)
      return { status: 200, body: { ok: true, id: input.id, receivedAt: toIso(created.receivedAt), duplicate: false } }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await findUpdate(db, input.id)
      if (winner) return existingOutcome(winner, viewer.userId)
    }
    throw error
  }
}

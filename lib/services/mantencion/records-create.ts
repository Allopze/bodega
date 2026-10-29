import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  mantRecordCorrectives, mantRecordDrivers, mantRecordItems, mantRecordParts, mantRecordPhotos, mantRecords,
  type MantEquipmentSnapshot,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { isUniqueViolation } from "@/lib/action-error"
import { nanoid } from "@/lib/id"
import type { SyncRecord, SyncRecordResponse } from "@/lib/mantencion/contracts"
import { canSeeRecord, recordVisibility, type MantViewer } from "./access"
import { nextFolio } from "./folio"
import { lockAndLoadVehicle } from "./records-create-context"
import { reject, type Author, type RecordFailure, type RecordPlan } from "./records-create-types"
import { validateRecord } from "./records-create-validate"
import type { SyncContext } from "./sync-auth"

/**
 * Recepción de un registro firmado en el teléfono (`POST …/sync/registros`).
 *
 * Idempotente por `id` (lo genera el teléfono): el mismo registro enviado tres
 * veces deja UNA fila y devuelve siempre el mismo folio. Todo ocurre en una
 * transacción; el folio se toma al final para sostener lo menos posible el
 * bloqueo del contador. Un registro firmado no se modifica jamás: sólo se crea.
 */

export interface RecordOutcome {
  status: 200 | 409 | 422
  body: SyncRecordResponse
}

type ExistingRecord = { id: string; folio: string | null; receivedAt: string; registeredBy: string }
type Reader = Pick<Tx, "select">

const toIso = (value: string) => new Date(value).toISOString()

async function findExisting(client: Reader, id: string): Promise<ExistingRecord | null> {
  const [row] = await client
    .select({ id: mantRecords.id, folio: mantRecords.folio, receivedAt: mantRecords.receivedAt, registeredBy: mantRecords.registeredBy })
    .from(mantRecords)
    .where(eq(mantRecords.id, id))
    .limit(1)
  return row ?? null
}

function existingOutcome(existing: ExistingRecord, userId: string): RecordOutcome {
  if (existing.registeredBy !== userId) {
    return { status: 409, body: { ok: false, code: "rejected", message: "Ese identificador de registro ya pertenece a otra persona." } }
  }
  return {
    status: 200,
    body: { ok: true, id: existing.id, folio: existing.folio ?? "", receivedAt: toIso(existing.receivedAt), duplicate: true, warnings: [] },
  }
}

function failureOutcome(failure: RecordFailure): RecordOutcome {
  return { status: failure.status, body: { ok: false, code: failure.code, message: failure.message, field: failure.field } }
}

export async function createRecord(input: SyncRecord, context: SyncContext): Promise<RecordOutcome> {
  const author: Author = { userId: context.viewer.userId, name: context.userName, viewer: context.viewer }

  // Reenvío habitual (respuesta perdida): se contesta sin abrir transacción ni bloquear nada.
  const already = await findExisting(db, input.id)
  if (already) return existingOutcome(already, author.userId)

  try {
    return await db.transaction(async (tx): Promise<RecordOutcome> => {
      const vehicle = await lockAndLoadVehicle(tx, input.vehicleId)
      // Dos envíos simultáneos del mismo id se serializan en el bloqueo del equipo: el segundo ve al primero aquí.
      const raced = await findExisting(tx, input.id)
      if (raced) return existingOutcome(raced, author.userId)

      const validated = await validateRecord(tx, input, author, vehicle)
      if (!validated.ok) return failureOutcome(validated)
      const correction = await checkCorrection(tx, input, context.viewer)
      if (correction) return failureOutcome(correction)

      const plan = validated.value
      const folio = await nextFolio(tx, plan.vehicle.worksiteId, input.kind)
      const receivedAt = await insertRecord(tx, input, plan, author, context.deviceId, folio)
      return { status: 200, body: { ok: true, id: input.id, folio, receivedAt: toIso(receivedAt), duplicate: false, warnings: plan.warnings } }
    })
  } catch (error) {
    // Carrera por la llave primaria: otro envío del mismo id confirmó primero.
    if (isUniqueViolation(error)) {
      const winner = await findExisting(db, input.id)
      if (winner) return existingOutcome(winner, author.userId)
    }
    throw error
  }
}

/** Regla 13: «corrige» apunta a un registro anulado del mismo equipo que el autor puede ver. */
async function checkCorrection(tx: Tx, input: SyncRecord, viewer: MantViewer): Promise<RecordFailure | null> {
  if (!input.correctsRecordId) return null
  const [target] = await tx
    .select({
      status: mantRecords.status,
      vehicleId: mantRecords.vehicleId,
      worksiteId: mantRecords.worksiteId,
      registeredBy: mantRecords.registeredBy,
      executorUserId: mantRecords.executorUserId,
    })
    .from(mantRecords)
    .where(eq(mantRecords.id, input.correctsRecordId))
    .limit(1)
  if (!target || !canSeeRecord(recordVisibility(viewer), target)) return reject("El registro que quieres corregir no existe.", "correctsRecordId")
  if (target.status !== "anulado") return reject("Sólo se puede corregir un registro que jefatura anuló.", "correctsRecordId")
  if (target.vehicleId !== input.vehicleId) return reject("El registro que quieres corregir es de otro equipo.", "correctsRecordId")
  return null
}

async function insertRecord(
  tx: Tx,
  input: SyncRecord,
  plan: RecordPlan,
  author: Author,
  deviceId: string,
  folio: string,
): Promise<string> {
  const { vehicle, preventive, corrective } = plan
  const snapshot: MantEquipmentSnapshot = {
    code: vehicle.code,
    plate: vehicle.plate,
    noPlate: vehicle.noPlate,
    type: vehicle.typeName,
    brand: vehicle.brandName,
    model: vehicle.model,
    year: vehicle.year,
    worksite: vehicle.worksiteName,
    unit: vehicle.unit,
  }
  const [created] = await tx.insert(mantRecords).values({
    id: input.id,
    folio,
    kind: input.kind,
    vehicleId: vehicle.vehicleId,
    equipmentSnapshot: snapshot,
    worksiteId: vehicle.worksiteId,
    outOfWorksite: plan.outOfWorksite,
    reading: input.reading,
    unit: vehicle.unit,
    workDate: input.workDate,
    registeredBy: author.userId,
    executorKind: plan.executor.kind,
    executorUserId: plan.executor.userId,
    executorWorkshopId: plan.executor.workshopId,
    executorName: plan.executor.name,
    signedAt: input.signedAt,
    offlineSince: input.offlineSince,
    deviceId,
    appVersion: input.appVersion,
    readingJumpAlert: plan.readingJumpAlert,
    readingJumpConfirmed: input.readingJumpConfirmed,
    duplicateOfRecordId: preventive?.duplicateOf?.id ?? null,
    duplicateConfirmed: input.duplicateConfirmed,
    correctsRecordId: input.correctsRecordId,
    scheduleId: preventive?.scheduleId ?? null,
    scheduleVersion: preventive?.scheduleVersion ?? null,
    scheduleNameSnapshot: preventive?.scheduleName ?? null,
    intervalValue: preventive?.intervalValue ?? null,
    suggestedIntervalValue: preventive?.suggestedIntervalValue ?? null,
    manualScheduleReason: preventive?.manualScheduleReason ?? null,
    notes: preventive?.notes ?? null,
  }).returning({ receivedAt: mantRecords.receivedAt })
  if (!created) throw new Error("No se pudo guardar el registro")

  if (preventive) {
    await tx.insert(mantRecordItems).values(preventive.items.map((item) => ({
      id: nanoid(),
      recordId: input.id,
      itemKey: item.itemKey,
      groupName: item.groupName,
      itemName: item.itemName,
      sortOrder: item.sortOrder,
      value: item.value,
      reason: item.reason,
      manufacturerWarning: item.manufacturerWarning,
    })))
  }
  if (corrective) {
    await tx.insert(mantRecordCorrectives).values({
      recordId: input.id,
      workTypes: corrective.workTypes,
      oils: corrective.oils,
      description: corrective.description,
      noParts: corrective.noParts,
      hours: corrective.hours,
      inWorkshop: corrective.inWorkshop,
      workshopEntryDate: corrective.entryDate,
      workOrder: corrective.workOrder,
    })
    if (corrective.parts.length) {
      await tx.insert(mantRecordParts).values(corrective.parts.map((part, index) => ({
        id: nanoid(), recordId: input.id, quantity: part.quantity, description: part.description, sortOrder: index,
      })))
    }
    await tx.insert(mantRecordDrivers).values(corrective.drivers.map((driver) => ({
      recordId: input.id, driverId: driver.id, driverName: driver.name,
    })))
  }
  // Las fotos subidas antes quedan ancladas a este registro.
  for (const [index, photo] of plan.photos.entries()) {
    await tx.update(mantRecordPhotos).set({ recordId: input.id, sortOrder: index }).where(eq(mantRecordPhotos.id, photo.id))
  }

  await recordAudit({
    userId: author.userId,
    userEmail: author.viewer.email ?? undefined,
    action: "create",
    entityType: "mant_record",
    entityId: input.id,
    entityCode: folio,
    worksiteId: vehicle.worksiteId,
    newState: {
      kind: input.kind,
      vehicleId: vehicle.vehicleId,
      equipment: vehicle.code,
      reading: input.reading,
      unit: vehicle.unit,
      workDate: input.workDate,
      intervalValue: preventive?.intervalValue ?? null,
      executorKind: plan.executor.kind,
      outOfWorksite: plan.outOfWorksite,
      readingJumpAlert: plan.readingJumpAlert,
      duplicateOfRecordId: preventive?.duplicateOf?.id ?? null,
      photos: plan.photos.length,
      deviceId,
    },
  }, tx)
  return created.receivedAt
}

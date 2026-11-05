import { and, eq, isNull, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  mantRecordCorrectives, mantRecordDrivers, mantRecordItems, mantRecordJobs, mantRecordParts, mantRecordPhotos, mantRecords,
  mantWorkOrderEvents, mantWorkOrders,
  type MantEquipmentSnapshot,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { isUniqueViolation } from "@/lib/action-error"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import type { SyncRecord, SyncRecordResponse } from "@/lib/mantencion/contracts"
import { canSeeRecord, recordVisibility, type MantViewer } from "./access"
import { nextFolio } from "./folio"
import { lockAndLoadVehicle } from "./records-create-context"
import { reject, type Author, type RecordFailure, type RecordPlan } from "./records-create-types"
import { OT_PERMISSIONS } from "@/lib/mantencion/work-order-states"
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

/** PK de `mant_records`: la única violación única que significa «otro envío del mismo id». */
const RECORDS_PK = "mant_records_pkey"

/**
 * Una foto que el registro nombra ya está anclada a otro registro: otra
 * transacción la reclamó primero. Se lanza para revertir TODO el registro —que
 * si no quedaría firmado sin la evidencia que declara— y se traduce a un 409.
 */
class PhotoClaimError extends Error {
  constructor(readonly photoId: string) {
    super(`La foto ${photoId} ya pertenece a otro registro`)
    this.name = "PhotoClaimError"
  }
}

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
  // Un registro sin folio quedó a medio guardar: un 200 con `folio: ""` hacía que
  // la app lo diera por bueno y lo borraba de la cola.
  if (!existing.folio) {
    return { status: 409, body: { ok: false, code: "rejected", message: "Ese registro quedó guardado sin folio: avisa a jefatura para regularizarlo." } }
  }
  return {
    status: 200,
    body: { ok: true, id: existing.id, folio: existing.folio, receivedAt: toIso(existing.receivedAt), duplicate: true, warnings: [] },
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
      // Enlace con la OT: se bloquea DESPUÉS del equipo (orden único equipo → OT, el mismo de las transiciones de la OT).
      const link = await checkWorkOrderLink(tx, input, author)
      if (!link.ok) return failureOutcome(link)

      const plan = validated.value
      const folio = await nextFolio(tx, plan.vehicle.worksiteId, input.kind)
      const receivedAt = await insertRecord(tx, input, plan, author, context.deviceId, folio, link.workOrder)
      return { status: 200, body: { ok: true, id: input.id, folio, receivedAt: toIso(receivedAt), duplicate: false, warnings: plan.warnings } }
    })
  } catch (error) {
    // Una foto reclamada por otro registro: el registro no se guarda a medias.
    if (error instanceof PhotoClaimError) {
      return {
        status: 409,
        body: { ok: false, code: "missing_photos", message: "Una foto ya pertenece a otro registro: vuelve a sacarla.", field: "photos" },
      }
    }
    if (isUniqueViolation(error)) {
      // Carrera por la llave primaria: otro envío del mismo id confirmó primero.
      if (isUniqueViolation(error, RECORDS_PK)) {
        const winner = await findExisting(db, input.id)
        if (winner) return existingOutcome(winner, author.userId)
      }
      // Cualquier otra violación única (folio, ítems) no se arregla reintentando:
      // un 500 dejaba al teléfono reintentando con backoff para siempre.
      logger.error("[mantencion/registros] violación única al guardar un registro", { recordId: input.id, error })
      return {
        status: 409,
        body: {
          ok: false,
          code: "rejected",
          message: "No se pudo guardar el registro por un conflicto con otro registro. No se reintentará solo: avisa a jefatura.",
        },
      }
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

type LinkedWorkOrder = { id: string; folio: string }

/**
 * Enlace del registro con su orden de trabajo (`workOrderId`, opcional: hay
 * teléfonos con colas armadas antes de que existiera). La OT se bloquea y debe
 * ser del mismo equipo, estar «en taller», y el registro lo firma el mecánico
 * asignado, salvo la jefatura. Nombrar como ejecutor a otra persona NO abre la
 * OT: sin consentimiento del asignado era una forma de firmar trabajo a su
 * nombre y hacerla avanzar. La OT manda sobre el taller: un registro enlazado no
 * puede declarar «queda en taller».
 */
async function checkWorkOrderLink(
  tx: Tx,
  input: SyncRecord,
  author: Author,
): Promise<{ ok: true; workOrder: LinkedWorkOrder | null } | RecordFailure> {
  if (!input.workOrderId) return { ok: true, workOrder: null }
  const [ot] = await tx
    .select({ id: mantWorkOrders.id, folio: mantWorkOrders.folio, vehicleId: mantWorkOrders.vehicleId, status: mantWorkOrders.status, assignedToUserId: mantWorkOrders.assignedToUserId })
    .from(mantWorkOrders)
    .where(eq(mantWorkOrders.id, input.workOrderId))
    .for("update")
    .limit(1)
  if (!ot) return reject("Esa orden de trabajo no existe.", "workOrderId")
  if (ot.vehicleId !== input.vehicleId) return reject(`La orden ${ot.folio} es de otro equipo.`, "workOrderId")
  if (ot.status !== "en_ejecucion") return reject(`La orden ${ot.folio} no está en taller: sólo se registra trabajo mientras está «En taller».`, "workOrderId")
  if (input.kind === "C" && input.inWorkshop) {
    return reject("La orden de trabajo ya lleva el estado de taller: este registro no puede marcar «queda en taller».", "inWorkshop")
  }
  const manages = author.viewer.permissions.includes(OT_PERMISSIONS.manage)
  const mayWork = manages || ot.assignedToUserId === author.userId
  if (!mayWork) {
    return { ok: false, status: 409, code: "rejected", message: `La orden ${ot.folio} está asignada a otra persona.`, field: "workOrderId" }
  }
  return { ok: true, workOrder: { id: ot.id, folio: ot.folio } }
}

async function insertRecord(
  tx: Tx,
  input: SyncRecord,
  plan: RecordPlan,
  author: Author,
  deviceId: string,
  folio: string,
  workOrder: LinkedWorkOrder | null,
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
    workOrderId: workOrder?.id ?? null,
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
      workshopReason: corrective.workshopReason,
    })
    // Trabajos y repuestos en la misma transacción: cada repuesto cuelga de su trabajo (`job_id`).
    const jobRows = corrective.jobs.map((job, index) => ({
      id: nanoid(), recordId: input.id, workTypeId: job.workTypeId, workTypeName: job.workTypeName,
      hours: job.hours, noParts: job.noParts, sortOrder: index,
    }))
    await tx.insert(mantRecordJobs).values(jobRows)
    const partRows = corrective.jobs.flatMap((job, jobIndex) => job.parts.map((part, index) => ({
      id: nanoid(), recordId: input.id, jobId: (jobRows[jobIndex] as { id: string }).id,
      quantity: part.quantity, description: part.description, sortOrder: index,
    })))
    if (partRows.length) await tx.insert(mantRecordParts).values(partRows)
    await tx.insert(mantRecordDrivers).values(corrective.drivers.map((driver) => ({
      recordId: input.id, driverId: driver.id, driverName: driver.name,
    })))
  }
  if (workOrder) {
    await tx.insert(mantWorkOrderEvents).values({
      id: nanoid(),
      workOrderId: workOrder.id,
      type: "record_linked",
      changeSet: { recordId: input.id, folio, kind: input.kind },
      actorUserId: author.userId,
      deviceId,
    })
    // El catálogo del teléfono lista los registros enlazados de la OT: su marca de tiempo tiene que moverse. La versión no, para no invalidar lo que la web tiene abierto.
    await tx.update(mantWorkOrders).set({ updatedAt: sql`now()` }).where(eq(mantWorkOrders.id, workOrder.id))
  }
  // Las fotos subidas antes quedan ancladas a este registro. El `record_id IS NULL`
  // es la exclusión mutua: dos registros de EQUIPOS distintos no comparten el bloqueo
  // del perfil, así que sin él la última transacción le robaba la foto a la primera.
  // Vale también la foto que ya es de ESTE registro (la misma regla de la validación).
  for (const [index, photo] of plan.photos.entries()) {
    const [claimed] = await tx.update(mantRecordPhotos)
      .set({ recordId: input.id, sortOrder: index })
      .where(and(
        eq(mantRecordPhotos.id, photo.id),
        or(isNull(mantRecordPhotos.recordId), eq(mantRecordPhotos.recordId, input.id)),
      ))
      .returning({ id: mantRecordPhotos.id })
    if (!claimed) throw new PhotoClaimError(photo.id)
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
      workOrder: workOrder?.folio ?? null,
    },
  }, tx)
  return created.receivedAt
}

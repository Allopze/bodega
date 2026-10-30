import { and, asc, desc, eq, ne } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  mantEquipmentProfiles, mantRecordCorrectives, mantRecordDrivers, mantRecordItems, mantRecordObservations,
  mantRecordPhotos, mantRecordVoids, mantRecords, mantWorkshopUpdates, users, worksites,
  type MantEquipmentSnapshot,
} from "@/db/schema"
import { readingBounds } from "@/lib/mantencion/readings"
import { workshopState, type WorkshopState } from "@/lib/mantencion/status"
import type {
  MantExecutorKind, MantItemValue, MantPhotoKind, MantReading, MantRecordKind, MantRecordStatus, MantReview, MantUnit,
} from "@/lib/mantencion/types"
import { todayInChile } from "@/lib/utils"
import { canSeeRecord, recordVisibility, recordVisibilitySql, type MantViewer } from "./access"
import { STAMP_GAP_LIMIT_HOURS } from "./records-filters"
import { loadRecordJobs, type RecordJob } from "./records-jobs"

/**
 * Todo lo que muestran el detalle de un registro, su PDF y su Excel individual,
 * leído de UNA sola fuente para que los tres digan lo mismo. Devuelve `null`
 * cuando el registro no existe O cuando el usuario no tiene alcance sobre él:
 * quien lo pide responde 404 en ambos casos, así que un id ajeno no confirma
 * que exista.
 */

export interface RecordDetailItem {
  key: string
  name: string
  value: MantItemValue
  reason: string | null
  manufacturerWarning: boolean
}

export interface RecordDetailPhoto {
  id: string
  kind: MantPhotoKind
  stampedAt: string
  receivedAt: string
  width: number
  height: number
}

export interface RecordDetail {
  id: string
  folio: string | null
  kind: MantRecordKind
  status: MantRecordStatus
  review: MantReview
  equipment: MantEquipmentSnapshot
  vehicleId: string
  worksiteId: string
  worksiteName: string
  outOfWorksite: boolean
  reading: number
  unit: MantUnit
  workDate: string
  previousReading: MantReading | null
  signedAt: string
  receivedAt: string
  offlineSince: string | null
  registeredById: string
  registeredByName: string
  executorKind: MantExecutorKind
  executorName: string
  readingJumpAlert: boolean
  readingJumpConfirmed: boolean
  duplicateConfirmed: boolean
  duplicateOf: { id: string; folio: string | null } | null
  correctsRecord: { id: string; folio: string | null } | null
  correctedBy: { id: string; folio: string | null } | null
  schedule: {
    name: string
    version: number
    intervalValue: number
    suggestedIntervalValue: number
    manualReason: string | null
  } | null
  notes: string | null
  /** Preventiva: ítems en el orden de la pauta, agrupados por sistema. */
  groups: Array<{ name: string; items: RecordDetailItem[] }>
  corrective: {
    workTypes: string[]
    oils: string[]
    description: string
    hours: number
    inWorkshop: boolean
    workshopEntryDate: string | null
    workOrder: string | null
    /** Por qué sigue en taller (sólo con `inWorkshop`). */
    workshopReason: string | null
    /** Trabajos con sus horas y repuestos; `hours` de arriba es el total. */
    jobs: RecordJob[]
    drivers: string[]
    workshop: WorkshopState | null
    updates: Array<{ id: string; kind: "sigue" | "salio"; note: string | null; exitDate: string | null; userName: string; createdAt: string }>
  } | null
  photos: RecordDetailPhoto[]
  observations: Array<{
    id: string; text: string; userName: string; createdAt: string
    response: string | null; respondedByName: string | null; respondedAt: string | null
  }>
  voided: { reason: string; userName: string; createdAt: string } | null
  /**
   * La mayor diferencia entre un instante del teléfono (la firma o el sello de una foto) y la
   * recepción, cuando supera el límite sin un período sin señal registrado. Dice cuál fue el
   * instante para que el aviso nombre la foto o la firma y no sólo «hay una diferencia».
   */
  stampGap: {
    hours: number
    subject: "firma" | "foto"
    /** La foto que difiere (sólo con `subject: "foto"`). */
    photoId: string | null
    /** El instante que difiere: el sello de la foto o la firma. */
    at: string
  } | null
  history: Array<{ id: string; folio: string | null; kind: MantRecordKind; workDate: string; reading: number; unit: MantUnit; intervalValue: number | null }>
  pdfStorageKey: string | null
}

const PHOTO_RANK: Record<MantPhotoKind, number> = { filtros: 0, sticker: 1, correctiva: 2 }

function hoursApart(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 3_600_000
}

export async function loadRecordDetail(viewer: MantViewer, id: string): Promise<RecordDetail | null> {
  const registrar = alias(users, "registrar")
  const duplicate = alias(mantRecords, "duplicate")
  const corrects = alias(mantRecords, "corrects")
  const [row] = await db
    .select({
      record: mantRecords,
      worksiteName: worksites.name,
      registeredByName: registrar.name,
      duplicateFolio: duplicate.folio,
      correctsFolio: corrects.folio,
    })
    .from(mantRecords)
    .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
    .innerJoin(registrar, eq(registrar.id, mantRecords.registeredBy))
    .leftJoin(duplicate, eq(duplicate.id, mantRecords.duplicateOfRecordId))
    .leftJoin(corrects, eq(corrects.id, mantRecords.correctsRecordId))
    .where(eq(mantRecords.id, id))
    .limit(1)
  if (!row) return null
  const record = row.record
  const visibility = recordVisibility(viewer)
  if (!canSeeRecord(visibility, record)) return null

  const responder = alias(users, "responder")
  const author = alias(users, "author")
  const updater = alias(users, "updater")
  const isCorrective = record.kind === "C"

  const [
    items, corrective, jobs, drivers, updates, photos, observations, [voidRow], [correctedByRow], history, readings, [profile],
  ] = await Promise.all([
    record.kind === "P"
      ? db.select().from(mantRecordItems).where(eq(mantRecordItems.recordId, id)).orderBy(asc(mantRecordItems.sortOrder), asc(mantRecordItems.itemName))
      : Promise.resolve([]),
    isCorrective
      ? db.select().from(mantRecordCorrectives).where(eq(mantRecordCorrectives.recordId, id)).limit(1)
      : Promise.resolve([]),
    isCorrective
      ? loadRecordJobs(id)
      : Promise.resolve([]),
    isCorrective
      ? db.select({ name: mantRecordDrivers.driverName }).from(mantRecordDrivers).where(eq(mantRecordDrivers.recordId, id)).orderBy(asc(mantRecordDrivers.driverName))
      : Promise.resolve([]),
    isCorrective
      ? db.select({
        id: mantWorkshopUpdates.id, kind: mantWorkshopUpdates.kind, note: mantWorkshopUpdates.note,
        exitDate: mantWorkshopUpdates.exitDate, createdAt: mantWorkshopUpdates.createdAt, userName: updater.name,
      }).from(mantWorkshopUpdates).innerJoin(updater, eq(updater.id, mantWorkshopUpdates.userId))
        .where(eq(mantWorkshopUpdates.recordId, id)).orderBy(asc(mantWorkshopUpdates.createdAt))
      : Promise.resolve([]),
    db.select().from(mantRecordPhotos).where(eq(mantRecordPhotos.recordId, id)),
    db.select({
      id: mantRecordObservations.id, text: mantRecordObservations.text, createdAt: mantRecordObservations.createdAt,
      response: mantRecordObservations.response, respondedAt: mantRecordObservations.respondedAt,
      userName: author.name, respondedByName: responder.name,
    }).from(mantRecordObservations)
      .innerJoin(author, eq(author.id, mantRecordObservations.userId))
      .leftJoin(responder, eq(responder.id, mantRecordObservations.respondedBy))
      .where(eq(mantRecordObservations.recordId, id)).orderBy(asc(mantRecordObservations.createdAt)),
    db.select({ reason: mantRecordVoids.reason, createdAt: mantRecordVoids.createdAt, userName: users.name })
      .from(mantRecordVoids).innerJoin(users, eq(users.id, mantRecordVoids.userId))
      .where(eq(mantRecordVoids.recordId, id)).limit(1),
    db.select({ id: mantRecords.id, folio: mantRecords.folio }).from(mantRecords)
      .where(eq(mantRecords.correctsRecordId, id)).orderBy(desc(mantRecords.receivedAt)).limit(1),
    // El historial respeta el alcance: una preventiva de otra faena no se cuela por el equipo.
    db.select({
      id: mantRecords.id, folio: mantRecords.folio, kind: mantRecords.kind, workDate: mantRecords.workDate,
      reading: mantRecords.reading, unit: mantRecords.unit, intervalValue: mantRecords.intervalValue,
    }).from(mantRecords)
      .where(and(eq(mantRecords.vehicleId, record.vehicleId), ne(mantRecords.id, id), eq(mantRecords.status, "vigente"), recordVisibilitySql(visibility)))
      .orderBy(desc(mantRecords.workDate), desc(mantRecords.receivedAt)).limit(5),
    // La lectura anterior sale de todos los vigentes del equipo (regla 2), sin folio ni más dato que el número y su fecha.
    db.select({ reading: mantRecords.reading, workDate: mantRecords.workDate })
      .from(mantRecords)
      .where(and(eq(mantRecords.vehicleId, record.vehicleId), ne(mantRecords.id, id), eq(mantRecords.status, "vigente")))
      .orderBy(desc(mantRecords.workDate), desc(mantRecords.reading)).limit(40),
    db.select({ value: mantEquipmentProfiles.initialReading, date: mantEquipmentProfiles.initialReadingDate })
      .from(mantEquipmentProfiles).where(eq(mantEquipmentProfiles.vehicleId, record.vehicleId)).limit(1),
  ])

  const initial: MantReading | null = profile?.value != null && profile.date
    ? { value: profile.value, date: profile.date, source: "Lectura inicial" }
    : null
  const previousReading = readingBounds(
    readings.map((item) => ({ value: item.reading, date: item.workDate, source: "Registro" })),
    initial,
    record.workDate,
  ).previous

  const groups = new Map<string, RecordDetailItem[]>()
  for (const item of items) {
    const list = groups.get(item.groupName) ?? []
    list.push({ key: item.itemKey, name: item.itemName, value: item.value as MantItemValue, reason: item.reason, manufacturerWarning: item.manufacturerWarning })
    groups.set(item.groupName, list)
  }

  const correctiveRow = corrective[0]
  const orderedPhotos = photos
    .map((photo) => ({ ...photo, kind: photo.kind as MantPhotoKind }))
    .sort((a, b) => PHOTO_RANK[a.kind] - PHOTO_RANK[b.kind] || a.sortOrder - b.sortOrder || a.receivedAt.localeCompare(b.receivedAt))

  // Regla 8: el sello (o la firma) de una hora y la recepción de otra, sin un período
  // sin señal que lo explique, es lo único que la jefatura puede ver para dudar de la hora.
  const gaps: Array<NonNullable<RecordDetail["stampGap"]>> = [
    { hours: hoursApart(record.signedAt, record.receivedAt), subject: "firma", photoId: null, at: record.signedAt },
    ...orderedPhotos.map((photo) => ({ hours: hoursApart(photo.stampedAt, record.receivedAt), subject: "foto" as const, photoId: photo.id, at: photo.stampedAt })),
  ]
  const worstGap = gaps.reduce((worst, gap) => (gap.hours > worst.hours ? gap : worst))
  const stampGap = !record.offlineSince && worstGap.hours > STAMP_GAP_LIMIT_HOURS ? { ...worstGap, hours: Math.round(worstGap.hours) } : null

  return {
    id: record.id,
    folio: record.folio,
    kind: record.kind as MantRecordKind,
    status: record.status as MantRecordStatus,
    review: record.review as MantReview,
    equipment: record.equipmentSnapshot,
    vehicleId: record.vehicleId,
    worksiteId: record.worksiteId,
    worksiteName: row.worksiteName,
    outOfWorksite: record.outOfWorksite,
    reading: record.reading,
    unit: record.unit as MantUnit,
    workDate: record.workDate,
    previousReading,
    signedAt: record.signedAt,
    receivedAt: record.receivedAt,
    offlineSince: record.offlineSince,
    registeredById: record.registeredBy,
    registeredByName: row.registeredByName,
    executorKind: record.executorKind as MantExecutorKind,
    executorName: record.executorName,
    readingJumpAlert: record.readingJumpAlert,
    readingJumpConfirmed: record.readingJumpConfirmed,
    duplicateConfirmed: record.duplicateConfirmed,
    duplicateOf: record.duplicateOfRecordId ? { id: record.duplicateOfRecordId, folio: row.duplicateFolio } : null,
    correctsRecord: record.correctsRecordId ? { id: record.correctsRecordId, folio: row.correctsFolio } : null,
    correctedBy: correctedByRow ?? null,
    schedule: record.kind === "P" && record.scheduleNameSnapshot && record.intervalValue != null && record.suggestedIntervalValue != null
      ? {
        name: record.scheduleNameSnapshot,
        version: record.scheduleVersion ?? 1,
        intervalValue: record.intervalValue,
        suggestedIntervalValue: record.suggestedIntervalValue,
        manualReason: record.manualScheduleReason,
      }
      : null,
    notes: record.notes,
    groups: [...groups].map(([name, list]) => ({ name, items: list })),
    corrective: correctiveRow
      ? {
        workTypes: correctiveRow.workTypes,
        oils: correctiveRow.oils,
        description: correctiveRow.description,
        hours: correctiveRow.hours,
        inWorkshop: correctiveRow.inWorkshop,
        workshopEntryDate: correctiveRow.workshopEntryDate,
        workOrder: correctiveRow.workOrder,
        workshopReason: correctiveRow.workshopReason,
        jobs,
        drivers: drivers.map((driver) => driver.name),
        workshop: correctiveRow.inWorkshop
          ? workshopState({
            inWorkshop: true,
            entryDate: correctiveRow.workshopEntryDate,
            workDate: record.workDate,
            updates: updates.map((update) => ({ kind: update.kind as "sigue" | "salio", createdDate: todayInChile(update.createdAt), exitDate: update.exitDate })),
          }, todayInChile())
          : null,
        updates: updates.map((update) => ({ ...update, kind: update.kind as "sigue" | "salio" })),
      }
      : null,
    photos: orderedPhotos.map((photo) => ({
      id: photo.id, kind: photo.kind, stampedAt: photo.stampedAt, receivedAt: photo.receivedAt, width: photo.width, height: photo.height,
    })),
    observations,
    voided: voidRow ?? null,
    stampGap,
    history: history.map((item) => ({ ...item, kind: item.kind as MantRecordKind, unit: item.unit as MantUnit })),
    pdfStorageKey: record.pdfStorageKey,
  }
}

/** Para los encabezados que sólo necesitan saber si existe y a quién pertenece (PDF, auditoría). */
export async function loadRecordAccessRow(id: string) {
  const [row] = await db
    .select({
      id: mantRecords.id, folio: mantRecords.folio, status: mantRecords.status, worksiteId: mantRecords.worksiteId,
      registeredBy: mantRecords.registeredBy, executorUserId: mantRecords.executorUserId, pdfStorageKey: mantRecords.pdfStorageKey,
    })
    .from(mantRecords).where(eq(mantRecords.id, id)).limit(1)
  return row ?? null
}

/** Cuántas observaciones y respuestas hay sin atender (para el aviso del detalle). */
export function pendingObservations(detail: Pick<RecordDetail, "observations">): number {
  return detail.observations.filter((observation) => observation.response === null).length
}


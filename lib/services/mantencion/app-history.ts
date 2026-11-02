import { createHash } from "node:crypto"
import { and, asc, eq, inArray, lte, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantEquipmentProfiles, mantRecordCorrectives, mantRecordItems, mantRecordJobs,
  mantRecordParts, mantRecordPhotos, mantRecords, mantWorkOrders, mantWorkshopUpdates, worksites,
} from "@/db/schema"
import { HISTORY_PER_EQUIPMENT, type AppHistory, type AppHistoryPhoto, type AppHistoryRecord } from "@/lib/mantencion/contracts"
import { workshopState } from "@/lib/mantencion/status"
import type { MantExecutorKind, MantItemValue, MantPhotoKind, MantRecordKind, MantUnit } from "@/lib/mantencion/types"
import { todayInChile } from "@/lib/utils"
import type { MantViewer } from "./access"
import { groupJobs } from "./records-jobs"

/**
 * Historial de la flota para la app del mecánico (`GET /api/mantencion/sync/historial`).
 *
 * Los últimos `HISTORY_PER_EQUIPMENT` registros VIGENTES de cada equipo activo,
 * de cualquier faena y de cualquier autor: el mecánico consulta lo que se le hizo
 * a un equipo aunque no sea de su faena ni lo haya hecho él. Por eso el resultado
 * no depende de quién pide (`historyVersion` tampoco) y la app puede cachearlo con
 * un solo ETag.
 *
 * Es una proyección de lectura, no un segundo detalle de registro: sólo lo que
 * el contrato `AppHistoryRecord` nombra. Los anulados, las observaciones de
 * supervisión, la revisión, los datos de la anulación, las anomalías de sello,
 * quién recibió el registro y las banderas de lectura no salen de aquí.
 */

/** Súbelo cuando cambie la FORMA de la respuesta: invalida el historial guardado en los teléfonos. */
export const HISTORY_FORMAT = 1

const PHOTO_RANK: Record<MantPhotoKind, number> = { filtros: 0, sticker: 1, correctiva: 2 }

type RankedRow = {
  record: typeof mantRecords.$inferSelect
  worksiteName: string
  workOrderFolio: string | null
}

/**
 * Los registros a enviar: ventana por equipo sobre los vigentes de los equipos
 * ACTIVOS de la flota (mismo criterio que `loadFleet`: con ficha de mantención,
 * `fuel_vehicles.is_active` y un medidor que la app sepa leer). Desempate
 * estable: fecha del trabajo, recepción, id.
 */
async function selectRecords(): Promise<RankedRow[]> {
  const ranked = db
    .select({
      id: mantRecords.id,
      rn: sql<number>`row_number() over (partition by ${mantRecords.vehicleId} order by ${mantRecords.workDate} desc, ${mantRecords.receivedAt} desc, ${mantRecords.id} asc)`.as("rn"),
    })
    .from(mantRecords)
    .innerJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, mantRecords.vehicleId))
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantRecords.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(and(
      eq(mantRecords.status, "vigente"),
      eq(fuelVehicles.isActive, true),
      inArray(fuelEquipmentTypes.defaultMeterType, ["odometer", "hour_meter"]),
    ))
    .as("ranked")

  const rows = await db
    .select({ record: mantRecords, worksiteName: worksites.name, workOrderFolio: mantWorkOrders.folio })
    .from(ranked)
    .innerJoin(mantRecords, eq(mantRecords.id, ranked.id))
    .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
    .leftJoin(mantWorkOrders, eq(mantWorkOrders.id, mantRecords.workOrderId))
    .where(lte(ranked.rn, HISTORY_PER_EQUIPMENT))
  // De más reciente a más antiguo dentro de cada equipo; el desempate repite el de la ventana.
  return rows.sort((a, b) =>
    a.record.vehicleId.localeCompare(b.record.vehicleId)
    || b.record.workDate.localeCompare(a.record.workDate)
    || b.record.receivedAt.localeCompare(a.record.receivedAt)
    || a.record.id.localeCompare(b.record.id))
}

function groupById<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const list = map.get(key(row)) ?? []
    list.push(row)
    map.set(key(row), list)
  }
  return map
}

export async function loadAppHistory(_viewer: MantViewer, knownVersion?: string): Promise<AppHistory> {
  // La versión se calcula ANTES de leer: si algo cambia a medio camino, el ETag queda atrasado y el
  // teléfono vuelve a pedir (un falso «cambió»), nunca al revés.
  const version = knownVersion ?? await historyVersion()
  const selected = await selectRecords()
  const byVehicle: Record<string, AppHistoryRecord[]> = {}
  if (selected.length === 0) return { version, generatedAt: new Date().toISOString(), byVehicle }

  const ids = selected.map((row) => row.record.id)
  const preventiveIds = selected.filter((row) => row.record.kind === "P").map((row) => row.record.id)
  const correctiveIds = selected.filter((row) => row.record.kind === "C").map((row) => row.record.id)

  const [items, correctives, jobs, parts, updates, photos] = await Promise.all([
    preventiveIds.length
      ? db.select({
        recordId: mantRecordItems.recordId, groupName: mantRecordItems.groupName, itemName: mantRecordItems.itemName,
        value: mantRecordItems.value, reason: mantRecordItems.reason,
      }).from(mantRecordItems).where(inArray(mantRecordItems.recordId, preventiveIds))
        .orderBy(asc(mantRecordItems.recordId), asc(mantRecordItems.sortOrder), asc(mantRecordItems.itemName))
      : Promise.resolve([]),
    correctiveIds.length
      ? db.select().from(mantRecordCorrectives).where(inArray(mantRecordCorrectives.recordId, correctiveIds))
      : Promise.resolve([]),
    correctiveIds.length
      ? db.select({
        id: mantRecordJobs.id, recordId: mantRecordJobs.recordId, workTypeName: mantRecordJobs.workTypeName,
        hours: mantRecordJobs.hours, noParts: mantRecordJobs.noParts,
      }).from(mantRecordJobs).where(inArray(mantRecordJobs.recordId, correctiveIds)).orderBy(asc(mantRecordJobs.recordId), asc(mantRecordJobs.sortOrder))
      : Promise.resolve([]),
    correctiveIds.length
      ? db.select({
        recordId: mantRecordParts.recordId, jobId: mantRecordParts.jobId, quantity: mantRecordParts.quantity, description: mantRecordParts.description,
      }).from(mantRecordParts).where(inArray(mantRecordParts.recordId, correctiveIds)).orderBy(asc(mantRecordParts.recordId), asc(mantRecordParts.sortOrder))
      : Promise.resolve([]),
    // Las novedades de taller sólo importan a las correctivas que pasaron por taller.
    correctiveIds.length
      ? db.select({
        recordId: mantWorkshopUpdates.recordId, kind: mantWorkshopUpdates.kind, exitDate: mantWorkshopUpdates.exitDate, createdAt: mantWorkshopUpdates.createdAt,
      }).from(mantWorkshopUpdates).where(inArray(mantWorkshopUpdates.recordId, correctiveIds)).orderBy(asc(mantWorkshopUpdates.createdAt))
      : Promise.resolve([]),
    db.select({
      id: mantRecordPhotos.id, recordId: mantRecordPhotos.recordId, kind: mantRecordPhotos.kind, width: mantRecordPhotos.width,
      height: mantRecordPhotos.height, sortOrder: mantRecordPhotos.sortOrder, receivedAt: mantRecordPhotos.receivedAt,
    }).from(mantRecordPhotos).where(inArray(mantRecordPhotos.recordId, ids)),
  ])

  const itemsByRecord = groupById(items, (row) => row.recordId)
  const correctiveByRecord = new Map(correctives.map((row) => [row.recordId, row]))
  const jobsByRecord = groupById(jobs, (row) => row.recordId)
  const partsByRecord = groupById(parts, (row) => row.recordId)
  const updatesByRecord = groupById(updates, (row) => row.recordId)
  const photosByRecord = groupById(photos.filter((photo) => photo.recordId), (row) => row.recordId as string)
  const today = todayInChile()

  for (const { record, worksiteName, workOrderFolio } of selected) {
    const itemRows = itemsByRecord.get(record.id) ?? []
    const flagged = itemRows.filter((item) => item.value !== "R")
    const row = correctiveByRecord.get(record.id)

    let corrective: AppHistoryRecord["corrective"] = null
    if (row) {
      const state = row.inWorkshop
        ? workshopState({
          inWorkshop: true,
          entryDate: row.workshopEntryDate,
          workDate: record.workDate,
          updates: (updatesByRecord.get(record.id) ?? []).map((update) => ({
            kind: update.kind as "sigue" | "salio", createdDate: todayInChile(update.createdAt), exitDate: update.exitDate,
          })),
        }, today)
        : null
      corrective = {
        description: row.description,
        hours: row.hours,
        workTypes: row.workTypes,
        jobs: groupJobs(jobsByRecord.get(record.id) ?? [], partsByRecord.get(record.id) ?? [])
          .map((job) => ({ workTypeName: job.workTypeName, hours: job.hours, parts: job.parts })),
        workshopEntryDate: row.inWorkshop ? row.workshopEntryDate : null,
        workshopExitDate: state?.exitDate ?? null,
        stillInWorkshop: !!state?.inWorkshop,
      }
    }

    const recordPhotos: AppHistoryPhoto[] = (photosByRecord.get(record.id) ?? [])
      .map((photo) => ({ ...photo, kind: photo.kind as MantPhotoKind }))
      .sort((a, b) => PHOTO_RANK[a.kind] - PHOTO_RANK[b.kind] || a.sortOrder - b.sortOrder || a.receivedAt.localeCompare(b.receivedAt))
      .map((photo) => ({ id: photo.id, kind: photo.kind, width: photo.width, height: photo.height }))

    const entry: AppHistoryRecord = {
      id: record.id,
      folio: record.folio,
      kind: record.kind as MantRecordKind,
      vehicleId: record.vehicleId,
      worksiteName,
      workDate: record.workDate,
      reading: record.reading,
      unit: record.unit as MantUnit,
      executorKind: record.executorKind as MantExecutorKind,
      executorName: record.executorName,
      workOrderFolio,
      notes: record.notes,
      schedule: record.kind === "P" && record.scheduleNameSnapshot && record.intervalValue != null
        ? { name: record.scheduleNameSnapshot, intervalValue: record.intervalValue }
        : null,
      itemsDone: itemRows.length - flagged.length,
      itemsFlagged: flagged.map((item) => ({
        group: item.groupName, name: item.itemName, value: item.value as Exclude<MantItemValue, "R">, reason: item.reason,
      })),
      corrective,
      photos: recordPhotos,
    }
    ;(byVehicle[record.vehicleId] ??= []).push(entry)
  }
  return { version, generatedAt: new Date().toISOString(), byVehicle }
}

// ── Versión (ETag) ───────────────────────────────────────────────────────────

type Source = readonly [AnyPgTable, readonly AnyPgColumn[], SQL?]

/**
 * Cada fuente aporta el máximo de sus marcas de tiempo y su conteo. Un registro
 * anulado SALE del historial, así que se cuentan los vigentes aparte (más
 * `updated_at`): anular cambia la versión aunque no cambie el total de filas.
 */
const SOURCES: readonly Source[] = [
  [mantRecords, [mantRecords.receivedAt, mantRecords.updatedAt], sql`count(*) filter (where ${mantRecords.status} = 'vigente')::text`],
  [mantRecordItems, []],
  [mantRecordCorrectives, []],
  [mantRecordJobs, []],
  [mantRecordParts, []],
  // Una foto sube antes que su registro: sólo cuenta cuando ya está anclada a uno.
  [mantRecordPhotos, [mantRecordPhotos.receivedAt], sql`count(*) filter (where ${mantRecordPhotos.recordId} is not null)::text`],
  [mantWorkshopUpdates, [mantWorkshopUpdates.receivedAt]],
  // El folio de la OT enlazada y el nombre de la faena viajan en cada registro.
  [mantWorkOrders, [mantWorkOrders.updatedAt]],
  [worksites, [worksites.updatedAt]],
  // Qué equipos están activos (y con medidor legible) decide quién entra en el historial.
  [fuelVehicles, [fuelVehicles.updatedAt], sql`count(*) filter (where ${fuelVehicles.isActive})::text`],
  [mantEquipmentProfiles, [mantEquipmentProfiles.updatedAt]],
  [fuelEquipmentTypes, [fuelEquipmentTypes.updatedAt]],
]

function aggregate([table, columns, extra]: Source): SQL {
  const parts = [...columns.map((column) => sql`coalesce(max(${column})::text, '')`), sql`count(*)::text`, ...(extra ? [extra] : [])]
  return sql`(select ${sql.join(parts, sql` || '|' || `)} from ${table})`
}

function driverRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows?: T[] }).rows) ?? []
}

/**
 * Huella barata de «¿cambió algo que sale en el historial?». No depende de la
 * persona (el historial es el mismo para todos) ni del día de hoy (el contrato
 * no lleva días detenido). Heurística de caché: un falso «cambió» sólo cuesta una
 * descarga; un falso «no cambió» no puede ocurrir mientras cada tabla actualice
 * su marca de tiempo al editarse.
 */
export async function historyVersion(): Promise<string> {
  const result = await db.execute(sql`select ${sql.join(SOURCES.map(aggregate), sql` || '#' || `)} as fingerprint`)
  const fingerprint = driverRows<{ fingerprint: string }>(result)[0]?.fingerprint ?? ""
  return createHash("sha256").update(`${fingerprint}##${HISTORY_FORMAT}##${HISTORY_PER_EQUIPMENT}`).digest("hex").slice(0, 32)
}

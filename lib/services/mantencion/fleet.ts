import { and, asc, desc, eq, inArray, isNull, lte, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantBrands, mantEquipmentProfiles, mantRecordCorrectives, mantRecords,
  mantScheduleIntervals, mantSchedules, mantWorkshopUpdates, worksites,
} from "@/db/schema"
import { todayInChile } from "@/lib/utils"
import { equipmentStatus, workshopState, type WorkshopState } from "@/lib/mantencion/status"
import type { MantEquipmentStatus, MantReading, MantUnit } from "@/lib/mantencion/types"

/**
 * Estado de la flota de mantención, calculado en el servidor con las reglas
 * puras de `lib/mantencion/` (reglas 1, 6 y 11). Es la ÚNICA fuente del estado
 * de un equipo: la usan el catálogo de la app, el panel, la lista y la ficha de
 * equipos, y las exportaciones. Se calcula por consulta: con ~120 equipos son
 * tres lecturas indexadas, y así nunca hay un estado en caché desfasado de un
 * registro recién recibido o anulado.
 */

/** `"all"` = sin filtro de faena; un arreglo vacío = ninguna faena (cero filas). */
export type MantWorksiteScope = string[] | "all"

export interface FleetRow {
  vehicleId: string
  code: string
  plate: string
  noPlate: boolean
  typeId: string
  typeName: string
  unit: MantUnit
  brandId: string
  brandName: string
  model: string | null
  year: number | null
  worksiteId: string
  worksiteName: string
  scheduleId: string | null
  scheduleName: string | null
  /** Intervalos activos de su pauta, ordenados. */
  intervals: number[]
  retired: boolean
  retiredReason: string | null
  initialReading: { value: number; date: string } | null
  /** Lecturas vigentes más recientes (hasta `readingsPerEquipment`), de mayor a menor fecha. */
  readings: MantReading[]
  recentPreventives: Array<{ id: string; folio: string | null; reading: number; date: string; intervalValue: number }>
  status: MantEquipmentStatus
  /** Correctiva abierta con el equipo en taller, si hay. */
  workshop: (WorkshopState & { recordId: string; folio: string | null; entryDate: string | null; hours: number }) | null
}

export interface LoadFleetOptions {
  scope: MantWorksiteScope
  includeRetired?: boolean
  vehicleIds?: string[]
  readingsPerEquipment?: number
  today?: string
}

export function unitFromMeter(meterType: string): MantUnit | null {
  if (meterType === "odometer") return "km"
  if (meterType === "hour_meter") return "h"
  return null
}

function scopeFilter(scope: MantWorksiteScope): SQL | undefined {
  if (scope === "all") return undefined
  if (scope.length === 0) return sql`false`
  return inArray(fuelVehicles.worksiteId, scope)
}

export async function loadFleet(options: LoadFleetOptions): Promise<FleetRow[]> {
  const today = options.today ?? todayInChile()
  const perEquipment = options.readingsPerEquipment ?? 12
  const base = await db
    .select({
      vehicleId: fuelVehicles.id,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      model: fuelVehicles.model,
      year: fuelVehicles.year,
      isActive: fuelVehicles.isActive,
      worksiteId: fuelVehicles.worksiteId,
      worksiteName: worksites.name,
      typeId: fuelEquipmentTypes.id,
      typeName: fuelEquipmentTypes.name,
      meterType: fuelEquipmentTypes.defaultMeterType,
      brandId: mantBrands.id,
      brandName: mantBrands.name,
      scheduleId: mantSchedules.id,
      scheduleName: mantSchedules.name,
      noPlate: mantEquipmentProfiles.noPlate,
      retiredReason: mantEquipmentProfiles.retiredReason,
      initialReading: mantEquipmentProfiles.initialReading,
      initialReadingDate: mantEquipmentProfiles.initialReadingDate,
    })
    .from(mantEquipmentProfiles)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantEquipmentProfiles.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .innerJoin(mantBrands, eq(mantBrands.id, mantEquipmentProfiles.brandId))
    .leftJoin(mantSchedules, and(eq(mantSchedules.id, mantEquipmentProfiles.scheduleId), isNull(mantSchedules.deletedAt)))
    .where(and(
      scopeFilter(options.scope),
      options.includeRetired ? undefined : eq(fuelVehicles.isActive, true),
      options.vehicleIds ? inArray(fuelVehicles.id, options.vehicleIds.length ? options.vehicleIds : ["__none__"]) : undefined,
    ))
    .orderBy(asc(fuelVehicles.code))

  const vehicleIds = base.map((row) => row.vehicleId)
  if (vehicleIds.length === 0) return []
  const scheduleIds = [...new Set(base.map((row) => row.scheduleId).filter((value): value is string => !!value))]

  const [intervalRows, readingRows, preventiveRows, workshopRows] = await Promise.all([
    scheduleIds.length
      ? db.select({ scheduleId: mantScheduleIntervals.scheduleId, value: mantScheduleIntervals.value })
        .from(mantScheduleIntervals)
        .where(and(inArray(mantScheduleIntervals.scheduleId, scheduleIds), eq(mantScheduleIntervals.isActive, true)))
        .orderBy(asc(mantScheduleIntervals.value))
      : Promise.resolve([]),
    recentRecords(vehicleIds, perEquipment, false),
    recentRecords(vehicleIds, 5, true),
    openWorkshopRecords(vehicleIds),
  ])

  const intervalsBySchedule = groupBy(intervalRows, (row) => row.scheduleId)
  const readingsByVehicle = groupBy(readingRows, (row) => row.vehicleId)
  const preventivesByVehicle = groupBy(preventiveRows, (row) => row.vehicleId)
  const workshopByVehicle = new Map<string, FleetRow["workshop"]>()
  for (const row of workshopRows) {
    if (workshopByVehicle.has(row.vehicleId)) continue
    const state = workshopState({
      inWorkshop: true,
      entryDate: row.entryDate,
      workDate: row.workDate,
      updates: row.updates,
    }, today)
    if (state.inWorkshop) {
      workshopByVehicle.set(row.vehicleId, { ...state, recordId: row.recordId, folio: row.folio, entryDate: row.entryDate, hours: row.hours })
    }
  }

  const rows: FleetRow[] = []
  for (const row of base) {
    const unit = unitFromMeter(row.meterType)
    if (!unit) continue
    const intervals = row.scheduleId ? (intervalsBySchedule.get(row.scheduleId) ?? []).map((item) => item.value) : []
    const readings: MantReading[] = (readingsByVehicle.get(row.vehicleId) ?? [])
      .map((item) => ({ value: item.reading, date: item.workDate, source: item.folio ?? "Registro sin folio" }))
    const initial = row.initialReading != null && row.initialReadingDate
      ? { value: row.initialReading, date: row.initialReadingDate }
      : null
    const preventives = (preventivesByVehicle.get(row.vehicleId) ?? [])
      .map((item) => ({ id: item.id, folio: item.folio, reading: item.reading, date: item.workDate, intervalValue: item.intervalValue ?? 0 }))
    const last = preventives[0]
    rows.push({
      vehicleId: row.vehicleId,
      code: row.code ?? row.plate,
      plate: row.plate,
      noPlate: row.noPlate,
      typeId: row.typeId,
      typeName: row.typeName,
      unit,
      brandId: row.brandId,
      brandName: row.brandName,
      model: row.model,
      year: row.year,
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName,
      scheduleId: row.scheduleId,
      scheduleName: row.scheduleName,
      intervals,
      retired: !row.isActive,
      retiredReason: row.retiredReason,
      initialReading: initial,
      readings,
      recentPreventives: preventives,
      status: equipmentStatus({
        retired: !row.isActive,
        intervals: row.scheduleId && intervals.length ? intervals : null,
        readings,
        initial: initial ? { ...initial, source: "Lectura inicial" } : null,
        lastPreventive: last ? { reading: last.reading, date: last.date, intervalValue: last.intervalValue } : null,
      }),
      workshop: workshopByVehicle.get(row.vehicleId) ?? null,
    })
  }
  return rows
}

/** Registros vigentes más recientes por equipo (ventana por `row_number`). */
async function recentRecords(vehicleIds: string[], limit: number, preventiveOnly: boolean) {
  const ranked = db
    .select({
      id: mantRecords.id,
      folio: mantRecords.folio,
      vehicleId: mantRecords.vehicleId,
      reading: mantRecords.reading,
      workDate: mantRecords.workDate,
      intervalValue: mantRecords.intervalValue,
      rn: sql<number>`row_number() over (partition by ${mantRecords.vehicleId} order by ${mantRecords.workDate} desc, ${mantRecords.reading} desc)`.as("rn"),
    })
    .from(mantRecords)
    .where(and(
      inArray(mantRecords.vehicleId, vehicleIds),
      eq(mantRecords.status, "vigente"),
      preventiveOnly ? eq(mantRecords.kind, "P") : undefined,
    ))
    .as("ranked")
  return db.select().from(ranked).where(lte(ranked.rn, limit)).orderBy(asc(ranked.vehicleId), asc(ranked.rn))
}

/** Correctivas vigentes que dejaron el equipo en taller, con sus actualizaciones. */
async function openWorkshopRecords(vehicleIds: string[]) {
  const rows = await db
    .select({
      recordId: mantRecords.id,
      folio: mantRecords.folio,
      vehicleId: mantRecords.vehicleId,
      workDate: mantRecords.workDate,
      entryDate: mantRecordCorrectives.workshopEntryDate,
      hours: mantRecordCorrectives.hours,
    })
    .from(mantRecords)
    .innerJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
    .where(and(
      inArray(mantRecords.vehicleId, vehicleIds),
      eq(mantRecords.status, "vigente"),
      eq(mantRecordCorrectives.inWorkshop, true),
      sql`not exists (select 1 from ${mantWorkshopUpdates} u where u.record_id = ${mantRecords.id} and u.kind = 'salio')`,
    ))
    .orderBy(desc(mantRecords.workDate))
  if (rows.length === 0) return []
  const updates = await db
    .select({
      recordId: mantWorkshopUpdates.recordId,
      kind: mantWorkshopUpdates.kind,
      createdAt: mantWorkshopUpdates.createdAt,
      exitDate: mantWorkshopUpdates.exitDate,
    })
    .from(mantWorkshopUpdates)
    .where(inArray(mantWorkshopUpdates.recordId, rows.map((row) => row.recordId)))
  const byRecord = groupBy(updates, (update) => update.recordId)
  return rows.map((row) => ({
    ...row,
    updates: (byRecord.get(row.recordId) ?? []).map((update) => ({
      kind: update.kind as "sigue" | "salio",
      createdDate: todayInChile(update.createdAt),
      exitDate: update.exitDate,
    })),
  }))
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

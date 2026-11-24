import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantEquipmentProfiles, mantHistoricalRecords, mantHistoricalScheduleChecks,
  mantRecords, mantSchedules, mantWorkOrders, worksites,
} from "@/db/schema"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { nameKey } from "@/lib/mantencion/normalize"
import { formatDate, formatQty, todayInChile } from "@/lib/utils"
import { equipmentScope, recordVisibility, recordVisibilitySql, type MantViewer } from "../access"
import { unitFromMeter } from "../fleet"
import { loadPanelWorksites } from "../panel"
import { getCurrentScheduleSnapshots } from "../schedule-versions"
import { workOrderVisibility, workOrderVisibilitySql } from "../work-orders/access"
import { monthLabel, parseLookerFilters } from "./filters"
import type {
  LookerContext, LookerEquipmentOption, LookerFilters, LookerFrequencyOption, LookerOptions,
  ResolvedCheck, ResolvedCrossFilters, ResolvedEquipment, ResolvedWork,
} from "./types"

/**
 * Opciones y resolución de los filtros del tablero Looker.
 *
 * Todo lo que llega por la URL se valida contra el alcance del usuario: un equipo, una faena, una
 * OT o una pauta de otra faena se ignoran (no se muestran ni se usan para consultar). El alcance
 * de equipos y el de registros/OT se aplican con los mismos helpers del resto del módulo.
 */

type Raw = Record<string, string | string[] | undefined>

function equipmentLabel(code: string | null, plate: string): string {
  if (!code) return plate
  if (!plate || plate === code) return code
  return `${code} · ${plate}`
}

function scopeFilter(viewer: MantViewer) {
  const scope = equipmentScope(viewer)
  if (scope === "all") return undefined
  if (scope.length === 0) return sql`false`
  return inArray(fuelVehicles.worksiteId, scope)
}

/** Opciones de la barra: faenas activas del alcance, equipos activos con ficha y frecuencias en uso. */
export async function loadLookerOptions(viewer: MantViewer): Promise<LookerOptions> {
  const worksitesList = await loadPanelWorksites(viewer)
  const rows = await db.select({
    id: fuelVehicles.id,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    worksiteId: fuelVehicles.worksiteId,
    worksiteName: worksites.name,
    typeName: fuelEquipmentTypes.name,
    meterType: fuelEquipmentTypes.defaultMeterType,
    scheduleId: mantEquipmentProfiles.scheduleId,
    scheduleName: mantSchedules.name,
    priorPreventiveDate: mantEquipmentProfiles.priorPreventiveDate,
    priorPreventiveInterval: mantEquipmentProfiles.priorPreventiveInterval,
  })
    .from(mantEquipmentProfiles)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantEquipmentProfiles.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .leftJoin(mantSchedules, and(eq(mantSchedules.id, mantEquipmentProfiles.scheduleId), isNull(mantSchedules.deletedAt)))
    .where(and(eq(fuelVehicles.isActive, true), scopeFilter(viewer)))
    .orderBy(fuelVehicles.code, fuelVehicles.plate)

  const ids = rows.map((row) => row.id)
  const scheduleIds = [...new Set(rows.map((row) => row.scheduleId).filter((id): id is string => !!id))]
  const [snapshots, lastPreventives] = await Promise.all([
    scheduleIds.length ? getCurrentScheduleSnapshots(scheduleIds) : Promise.resolve([]),
    ids.length
      ? db.selectDistinctOn([mantRecords.vehicleId], {
        vehicleId: mantRecords.vehicleId,
        date: mantRecords.workDate,
        intervalValue: mantRecords.intervalValue,
      })
        .from(mantRecords)
        .where(and(eq(mantRecords.kind, "P"), eq(mantRecords.status, "vigente"), inArray(mantRecords.vehicleId, ids)))
        .orderBy(mantRecords.vehicleId, desc(mantRecords.workDate), desc(mantRecords.reading))
      : Promise.resolve([]),
  ])
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
  const lastByVehicle = new Map(lastPreventives.map((row) => [row.vehicleId, row]))

  const equipment: LookerEquipmentOption[] = rows.map((row) => {
    const snapshot = row.scheduleId ? snapshotById.get(row.scheduleId) : undefined
    const signed = lastByVehicle.get(row.id)
    // La declarada (anterior a la plataforma) manda sólo si es más reciente que la firmada.
    const priorWins = row.priorPreventiveDate != null && row.priorPreventiveInterval != null
      && (!signed || row.priorPreventiveDate > signed.date)
    return {
      id: row.id,
      code: row.code ?? "",
      plate: row.plate,
      label: equipmentLabel(row.code, row.plate),
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName,
      typeName: row.typeName,
      unit: unitFromMeter(row.meterType),
      scheduleId: row.scheduleId,
      scheduleName: snapshot?.name ?? row.scheduleName,
      intervals: snapshot?.intervals ?? [],
      frequency: priorWins ? row.priorPreventiveInterval : signed?.intervalValue ?? null,
    }
  })

  const frequencyMap = new Map<string, LookerFrequencyOption>()
  for (const snapshot of snapshots) {
    for (const value of snapshot.intervals) {
      const key = `${snapshot.unit}:${value}`
      if (frequencyMap.has(key)) continue
      frequencyMap.set(key, {
        value,
        unit: snapshot.unit,
        label: `${formatQty(value)} ${snapshot.unit === "km" ? "km" : "h"}`,
      })
    }
  }
  const frequencies = [...frequencyMap.values()].sort((a, b) =>
    a.unit === b.unit ? a.value - b.value : a.unit === "km" ? -1 : 1)

  return { worksites: worksitesList, equipment, frequencies }
}

function toResolvedEquipment(option: LookerEquipmentOption | undefined, derivedFrom?: "work" | "check"): ResolvedEquipment | undefined {
  if (!option) return undefined
  return {
    id: option.id,
    code: option.code,
    plate: option.plate,
    label: option.label,
    worksiteId: option.worksiteId,
    worksiteName: option.worksiteName,
    unit: option.unit,
    intervals: option.intervals,
    frequency: option.frequency,
    ...(derivedFrom ? { derivedFrom } : {}),
  }
}

async function resolveWork(viewer: MantViewer, raw: string): Promise<ResolvedWork | null> {
  if (raw.startsWith("ot:")) {
    const id = raw.slice(3)
    const [row] = await db.select({
      id: mantWorkOrders.id, folio: mantWorkOrders.folio, vehicleId: mantWorkOrders.vehicleId, worksiteId: mantWorkOrders.worksiteId,
    })
      .from(mantWorkOrders)
      .where(and(eq(mantWorkOrders.id, id), workOrderVisibilitySql(workOrderVisibility(viewer))))
      .limit(1)
    return row ? { id: raw, label: row.folio, equipmentId: row.vehicleId, worksiteId: row.worksiteId } : null
  }
  if (raw.startsWith("r:")) {
    const id = raw.slice(2)
    const [row] = await db.select({
      id: mantRecords.id, folio: mantRecords.folio, vehicleId: mantRecords.vehicleId, worksiteId: mantRecords.worksiteId,
    })
      .from(mantRecords)
      .where(and(eq(mantRecords.id, id), recordVisibilitySql(recordVisibility(viewer))))
      .limit(1)
    return row ? { id: raw, label: row.folio ?? "Registro", equipmentId: row.vehicleId, worksiteId: row.worksiteId } : null
  }
  if (raw.startsWith("h:")) {
    const key = raw.slice(2)
    const [row] = await db.select({
      sourceKey: mantHistoricalRecords.sourceKey,
      reference: mantHistoricalRecords.sourceRecordId,
      orderText: mantHistoricalRecords.orderText,
      vehicleId: mantHistoricalRecords.vehicleId,
      worksiteId: mantHistoricalRecords.worksiteId,
    })
      .from(mantHistoricalRecords)
      .where(and(
        eq(mantHistoricalRecords.sourceKey, key),
        worksiteScopeSqlFor(equipmentScope(viewer), mantHistoricalRecords.worksiteId),
      ))
      .limit(1)
    return row ? {
      id: raw,
      label: row.reference || row.orderText || "Trabajo",
      equipmentId: row.vehicleId,
      worksiteId: row.worksiteId,
    } : null
  }
  return null
}

async function resolveCheck(viewer: MantViewer, raw: string, options: LookerOptions): Promise<ResolvedCheck | null> {
  if (raw.startsWith("h:")) {
    const key = raw.slice(2)
    const [row] = await db.select({
      sourceKey: mantHistoricalScheduleChecks.sourceKey,
      vehicleId: mantHistoricalScheduleChecks.vehicleId,
      worksiteId: mantHistoricalScheduleChecks.worksiteId,
      performedOn: mantHistoricalScheduleChecks.performedOn,
      submittedAt: mantHistoricalScheduleChecks.submittedAt,
      scheduleLabel: mantHistoricalScheduleChecks.scheduleLabel,
      equipmentText: mantHistoricalScheduleChecks.equipmentText,
    })
      .from(mantHistoricalScheduleChecks)
      .where(and(
        eq(mantHistoricalScheduleChecks.sourceKey, key),
        worksiteScopeSqlFor(equipmentScope(viewer), mantHistoricalScheduleChecks.worksiteId),
      ))
      .limit(1)
    if (!row) return null
    const date = row.performedOn ?? row.submittedAt.slice(0, 10)
    return {
      id: raw,
      label: `${row.equipmentText || "Equipo"} · ${formatDate(date)}`,
      equipmentId: row.vehicleId,
      worksiteId: row.worksiteId,
      month: date.slice(0, 7),
      level: row.scheduleLabel || null,
    }
  }
  if (raw.startsWith("r:")) {
    const id = raw.slice(2)
    const [row] = await db.select({
      id: mantRecords.id,
      vehicleId: mantRecords.vehicleId,
      worksiteId: mantRecords.worksiteId,
      workDate: mantRecords.workDate,
      intervalValue: mantRecords.intervalValue,
    })
      .from(mantRecords)
      .where(and(
        eq(mantRecords.id, id),
        eq(mantRecords.kind, "P"),
        eq(mantRecords.status, "vigente"),
        recordVisibilitySql(recordVisibility(viewer)),
      ))
      .limit(1)
    if (!row) return null
    const equipment = options.equipment.find((item) => item.id === row.vehicleId)
    const level = row.intervalValue != null ? `${formatQty(row.intervalValue)}` : "Pauta"
    return {
      id: raw,
      label: `${equipment?.label ?? "Equipo"} · ${formatDate(row.workDate)}`,
      equipmentId: row.vehicleId,
      worksiteId: row.worksiteId,
      month: row.workDate.slice(0, 7),
      level,
    }
  }
  return null
}

export async function resolveCrossFilters(
  viewer: MantViewer,
  filters: LookerFilters,
  options: LookerOptions,
): Promise<ResolvedCrossFilters> {
  const raw = filters.cross
  const explicitEquipment = raw.equipment ? options.equipment.find((item) => item.id === raw.equipment) : undefined
  const work = raw.work ? await resolveWork(viewer, raw.work) : null
  const check = raw.check ? await resolveCheck(viewer, raw.check, options) : null

  const workEquipment = work?.equipmentId ? options.equipment.find((item) => item.id === work.equipmentId) : undefined
  const checkEquipment = check?.equipmentId ? options.equipment.find((item) => item.id === check.equipmentId) : undefined
  const equipment = toResolvedEquipment(explicitEquipment)
    ?? toResolvedEquipment(workEquipment, "work")
    ?? toResolvedEquipment(checkEquipment, "check")

  const site = raw.worksite ? options.worksites.find((item) => item.id === raw.worksite) : undefined
  const rawConductor = raw.conductor?.trim()
  const rawMechanic = raw.mechanic?.trim()

  return {
    ...(equipment ? { equipment } : {}),
    ...(work ? { work } : {}),
    ...(check ? { check } : {}),
    ...(rawConductor ? { conductor: { key: nameKey(rawConductor), label: rawConductor } } : {}),
    ...(raw.month ? { month: { key: raw.month, label: monthLabel(raw.month) } } : {}),
    ...(site ? { worksite: { id: site.id, name: site.name } } : {}),
    ...(rawMechanic ? { mechanic: { key: nameKey(rawMechanic), label: rawMechanic } } : {}),
  }
}

/** Contexto completo de una pestaña Looker: filtros parseados, opciones y filtros cruzados resueltos. */
export async function loadLookerContext(viewer: MantViewer, raw: Raw, today: string = todayInChile()): Promise<LookerContext> {
  const filters = parseLookerFilters(raw, today)
  const options = await loadLookerOptions(viewer)
  const cross = await resolveCrossFilters(viewer, filters, options)
  return { filters, options, cross }
}

/** Ids de faena efectivos: intersección del alcance del usuario con lo pedido. */
export function effectiveWorksiteIds(viewer: MantViewer, requested: readonly string[]): string[] | "all" {
  const scope = equipmentScope(viewer)
  if (scope === "all") return requested.length ? [...requested] : "all"
  if (requested.length === 0) return scope
  return requested.filter((id) => scope.includes(id))
}

/** SQL de faena para una consulta que ya tiene su columna de faena. */
export function worksiteFilterSql(column: Parameters<typeof worksiteScopeSqlFor>[1], ids: string[] | "all") {
  return worksiteScopeSqlFor(ids, column)
}

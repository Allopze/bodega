import type { Session } from "next-auth"
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fuelTelemetryDaily, fuelVehicles } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { idlePct } from "../calc/idle"
import { mandanteWorksitesSql, selectedMonthKeys, type ControlFilters } from "../filters"

/**
 * Ralentí (V-01..V-09) sobre `fuel_telemetry_daily`. El % en vacío se recalcula
 * siempre desde las horas (`idlePct`); el % de un mes es Σvacío ÷ Σfuncionamiento
 * y, aparte, se reporta el promedio, máximo y mínimo de los % diarios.
 * Horas de trabajo = funcionamiento − vacío. Si dos fuentes informan el mismo
 * equipo y día se usa la de más horas de funcionamiento (no se suman).
 */

/** Período sobre `day` (texto `YYYY-MM-DD`): el rango manda sobre año + meses. */
export function telemetryPeriodSql(filters: ControlFilters): SQL {
  if (filters.from || filters.to) {
    return and(
      filters.from ? sql`${fuelTelemetryDaily.day} >= ${filters.from}` : undefined,
      filters.to ? sql`${fuelTelemetryDaily.day} <= ${filters.to}` : undefined,
    )!
  }
  return inArray(fuelTelemetryDaily.month, selectedMonthKeys(filters))
}

function vehicleScopeSql(session: Session | null, filters: ControlFilters): SQL | undefined {
  return and(
    worksiteScopeSql(session, fuelVehicles.worksiteId, filters.worksiteId),
    filters.mandanteId ? sql`${fuelVehicles.worksiteId} in ${mandanteWorksitesSql(filters.mandanteId)}` : undefined,
  )
}

/** Un registro por equipo y día, ya dentro del alcance y del período. */
export function dailyTelemetry(session: Session | null, filters: ControlFilters) {
  return db.selectDistinctOn([fuelTelemetryDaily.vehicleId, fuelTelemetryDaily.day], {
    vehicleId: fuelTelemetryDaily.vehicleId,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    day: fuelTelemetryDaily.day,
    month: fuelTelemetryDaily.month,
    operating: fuelTelemetryDaily.operatingHours,
    idle: fuelTelemetryDaily.idleHours,
    litersWorking: fuelTelemetryDaily.litersWorking,
    litersIdle: fuelTelemetryDaily.litersIdle,
  }).from(fuelTelemetryDaily)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelTelemetryDaily.vehicleId))
    .where(and(vehicleScopeSql(session, filters), telemetryPeriodSql(filters)))
    .orderBy(fuelTelemetryDaily.vehicleId, fuelTelemetryDaily.day, desc(fuelTelemetryDaily.operatingHours))
    .as("d")
}

type Daily = ReturnType<typeof dailyTelemetry>

export function equipmentLabel(code: string | null, plate: string): string {
  return code ? `${code} · ${plate}` : plate
}

/** ¿Hay alguna telemetría en el alcance del usuario, sin importar el período? Distingue «nunca se importó» de «no hay en este período». */
export async function hasTelemetryInScope(session: Session | null, filters: ControlFilters): Promise<boolean> {
  const rows = await db.select({ id: fuelTelemetryDaily.id }).from(fuelTelemetryDaily)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelTelemetryDaily.vehicleId))
    .where(vehicleScopeSql(session, { ...filters, mandanteId: undefined })).limit(1)
  return rows.length > 0
}

const aggregates = (d: Daily) => ({
  operatingHours: sql<number>`coalesce(sum(${d.operating}), 0)::float8`,
  idleHours: sql<number>`coalesce(sum(${d.idle}), 0)::float8`,
  activeDays: sql<number>`(count(*) filter (where ${d.operating} > 0))::int`,
  litersWorking: sql<number | null>`sum(${d.litersWorking})::float8`,
  litersIdle: sql<number | null>`sum(${d.litersIdle})::float8`,
  dailyAvgPct: sql<number | null>`(avg(${d.idle} / nullif(${d.operating}, 0) * 100) filter (where ${d.operating} > 0))::float8`,
  dailyMaxPct: sql<number | null>`(max(${d.idle} / nullif(${d.operating}, 0) * 100) filter (where ${d.operating} > 0))::float8`,
  dailyMinPct: sql<number | null>`(min(${d.idle} / nullif(${d.operating}, 0) * 100) filter (where ${d.operating} > 0))::float8`,
})

export interface IdleStats {
  operatingHours: number
  idleHours: number
  workingHours: number
  activeDays: number
  /** Σvacío ÷ Σfuncionamiento. */
  idlePct: number | null
  dailyAvgPct: number | null
  dailyMaxPct: number | null
  dailyMinPct: number | null
  /** Horas promedio por día con actividad. */
  avgWorkingPerDay: number | null
  avgIdlePerDay: number | null
  litersWorking: number | null
  litersIdle: number | null
}

type RawAggregates = { operatingHours: number; idleHours: number; activeDays: number; litersWorking: number | null; litersIdle: number | null; dailyAvgPct: number | null; dailyMaxPct: number | null; dailyMinPct: number | null }

function toStats(row: RawAggregates): IdleStats {
  const workingHours = Math.max(0, row.operatingHours - row.idleHours)
  return {
    operatingHours: row.operatingHours,
    idleHours: row.idleHours,
    workingHours,
    activeDays: row.activeDays,
    idlePct: idlePct(row.idleHours, row.operatingHours),
    dailyAvgPct: row.dailyAvgPct,
    dailyMaxPct: row.dailyMaxPct,
    dailyMinPct: row.dailyMinPct,
    avgWorkingPerDay: row.activeDays > 0 ? workingHours / row.activeDays : null,
    avgIdlePerDay: row.activeDays > 0 ? row.idleHours / row.activeDays : null,
    litersWorking: row.litersWorking,
    litersIdle: row.litersIdle,
  }
}

export interface IdleEquipmentMonthRow extends IdleStats {
  vehicleId: string
  equipment: string
  month: string
}

/** V-01..V-05: equipo × mes, y la fila de total general. */
export async function getIdleEquipmentMonths(session: Session | null, filters: ControlFilters): Promise<{ rows: IdleEquipmentMonthRow[]; total: IdleStats | null }> {
  const d = dailyTelemetry(session, filters)
  const [rows, totalRows] = await Promise.all([
    db.select({ vehicleId: d.vehicleId, code: d.code, plate: d.plate, month: d.month, ...aggregates(d) })
      .from(d).groupBy(d.vehicleId, d.code, d.plate, d.month).orderBy(d.code, d.plate, d.vehicleId, d.month),
    db.select(aggregates(d)).from(d),
  ])
  const total = totalRows[0] && rows.length > 0 ? toStats(totalRows[0]) : null
  return {
    rows: rows.map((row) => ({ ...toStats(row), vehicleId: row.vehicleId, equipment: equipmentLabel(row.code, row.plate), month: row.month })),
    total,
  }
}

export interface IdleMonthRow {
  month: string
  workingHours: number
  idleHours: number
  idlePct: number | null
  litersWorking: number | null
  litersIdle: number | null
  /** % de los litros informados que se gastó en vacío; `null` si falta uno de los dos litros. */
  idleLitersPct: number | null
}

/** V-06: serie mensual de toda la flota del alcance. */
export async function getIdleFleetMonths(session: Session | null, filters: ControlFilters): Promise<IdleMonthRow[]> {
  const d = dailyTelemetry(session, filters)
  const rows = await db.select({ month: d.month, ...aggregates(d) }).from(d).groupBy(d.month).orderBy(d.month)
  return rows.map((row) => {
    const stats = toStats(row)
    const litersKnown = stats.litersWorking !== null && stats.litersIdle !== null
    const litersTotal = litersKnown ? stats.litersWorking! + stats.litersIdle! : 0
    return {
      month: row.month,
      workingHours: stats.workingHours,
      idleHours: stats.idleHours,
      idlePct: stats.idlePct,
      litersWorking: stats.litersWorking,
      litersIdle: stats.litersIdle,
      idleLitersPct: litersKnown && litersTotal > 0 ? (stats.litersIdle! / litersTotal) * 100 : null,
    }
  })
}

export interface IdleVehicleOption { id: string; label: string; operatingHours: number }

/** Equipos con telemetría en el período, el de más horas primero (V-07 parte con ese). */
export async function listIdleVehicles(session: Session | null, filters: ControlFilters): Promise<IdleVehicleOption[]> {
  const d = dailyTelemetry(session, filters)
  const rows = await db.select({ id: d.vehicleId, code: d.code, plate: d.plate, hours: sql<number>`coalesce(sum(${d.operating}), 0)::float8` })
    .from(d).groupBy(d.vehicleId, d.code, d.plate).orderBy(desc(sql`sum(${d.operating})`), d.code, d.plate, d.vehicleId)
  return rows.map((row) => ({ id: row.id, label: equipmentLabel(row.code, row.plate), operatingHours: row.hours }))
}

export interface IdleDayPoint { day: string; operatingHours: number; idleHours: number; idlePct: number | null }

/** V-07: serie diaria de un equipo. */
export async function getIdleDailySeries(session: Session | null, filters: ControlFilters, vehicleId: string): Promise<IdleDayPoint[]> {
  const d = dailyTelemetry(session, filters)
  const rows = await db.select({ day: d.day, operating: d.operating, idle: d.idle }).from(d).where(eq(d.vehicleId, vehicleId)).orderBy(d.day)
  return rows.map((row) => ({ day: row.day, operatingHours: row.operating, idleHours: row.idle, idlePct: idlePct(row.idle, row.operating) }))
}

export interface IdleTopDay { day: string; equipment: string; operatingHours: number; idleHours: number; idlePct: number }

/** V-09: los días de mayor % en vacío, con al menos 1 hora de funcionamiento (un día de minutos daría 100 % sin significar nada). */
export async function getIdleTopDays(session: Session | null, filters: ControlFilters, limit = 20): Promise<IdleTopDay[]> {
  const d = dailyTelemetry(session, filters)
  const pct = sql<number>`(${d.idle} / ${d.operating} * 100)::float8`
  const rows = await db.select({ day: d.day, code: d.code, plate: d.plate, operating: d.operating, idle: d.idle, pct })
    .from(d).where(sql`${d.operating} >= 1`).orderBy(desc(pct), desc(d.operating), d.day, d.code, d.vehicleId).limit(limit)
  return rows.map((row) => ({ day: row.day, equipment: equipmentLabel(row.code, row.plate), operatingHours: row.operating, idleHours: row.idle, idlePct: row.pct }))
}

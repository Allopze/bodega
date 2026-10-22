import type { Session } from "next-auth"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelEquipmentTypes, fuelSupplyMedia, fuelVehicles, worksites } from "@/db/schema"
import type { PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { buildLoadWhere, countableLoadSql, statisticallyValidLoadSql, type ControlFilters } from "@/lib/combustibles/control/filters"
import { buildCrosstab, globalRatio, type Crosstab, type MonthMediumRow } from "@/lib/combustibles/control/view-helpers"
import { toNumber as num } from "./shared"

/**
 * Consultas de la vista general (G-01 a G-07). Todo se agrega en SQL; el alcance
 * de faena y los filtros salen de `buildLoadWhere`. Los litros cuentan toda carga
 * `countableLoadSql`; las razones km/L y L/h usan solo cargas con rendimiento
 * calculado y sin revisión pendiente (`statisticallyValidLoadSql`).
 */

/* ── Cifras de cabecera ──────────────────────────────────────────────────── */

export interface OverviewHeader {
  totalLiters: number
  loadCount: number
  /** km/L global (Σkm ÷ Σlitros de los tramos calculados); null sin tramos. */
  kmPerLiter: number | null
  /** L/h global (Σlitros ÷ Σhoras de los tramos calculados); null sin tramos. */
  litersPerHour: number | null
  /** Cargas en revisión dentro de los filtros. */
  flaggedCount: number
  /** Cargas en revisión con rendimiento calculado que NO entran a km/L ni L/h. */
  excludedKm: number
  excludedHours: number
}

export async function getOverviewHeader(session: Session, filters: ControlFilters): Promise<OverviewHeader> {
  const km = eq(fuelVehicles.performanceUnit, "km_per_liter")
  const hours = eq(fuelVehicles.performanceUnit, "liters_per_hour")
  const inReview = and(countableLoadSql, eq(fuelEquipmentLoads.reviewStatus, "flagged"))
  const computedInReview = and(inReview, eq(fuelEquipmentLoads.performanceStatus, "computed"))
  const [row] = await db.select({
    totalLiters: sql<number>`coalesce(sum(${fuelEquipmentLoads.liters}) filter (where ${countableLoadSql}), 0)::float8`,
    loadCount: sql<number>`(count(*) filter (where ${countableLoadSql}))::int`,
    kmSum: sql<number>`coalesce(sum(${fuelEquipmentLoads.meterDelta}) filter (where ${statisticallyValidLoadSql} and ${km}), 0)::float8`,
    kmLiters: sql<number>`coalesce(sum(${fuelEquipmentLoads.accumulatedLiters}) filter (where ${statisticallyValidLoadSql} and ${km}), 0)::float8`,
    hourSum: sql<number>`coalesce(sum(${fuelEquipmentLoads.meterDelta}) filter (where ${statisticallyValidLoadSql} and ${hours}), 0)::float8`,
    hourLiters: sql<number>`coalesce(sum(${fuelEquipmentLoads.accumulatedLiters}) filter (where ${statisticallyValidLoadSql} and ${hours}), 0)::float8`,
    flaggedCount: sql<number>`(count(*) filter (where ${inReview}))::int`,
    excludedKm: sql<number>`(count(*) filter (where ${computedInReview} and ${km}))::int`,
    excludedHours: sql<number>`(count(*) filter (where ${computedInReview} and ${hours}))::int`,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId)).where(buildLoadWhere(session, filters))
  return {
    totalLiters: num(row?.totalLiters),
    loadCount: num(row?.loadCount),
    kmPerLiter: globalRatio("km_per_liter", num(row?.kmSum), num(row?.kmLiters)),
    litersPerHour: globalRatio("liters_per_hour", num(row?.hourSum), num(row?.hourLiters)),
    flaggedCount: num(row?.flaggedCount),
    excludedKm: num(row?.excludedKm),
    excludedHours: num(row?.excludedHours),
  }
}

/* ── G-02: litros por mes y medio de suministro ──────────────────────────── */

export async function getLitersByMonthAndMedium(session: Session, filters: ControlFilters): Promise<MonthMediumRow[]> {
  const rows = await db.select({
    month: fuelEquipmentLoads.month,
    mediumId: fuelSupplyMedia.id,
    mediumName: fuelSupplyMedia.name,
    mediumOrder: fuelSupplyMedia.sortOrder,
    liters: sql<number>`sum(${fuelEquipmentLoads.liters})::float8`,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .leftJoin(fuelSupplyMedia, eq(fuelSupplyMedia.id, fuelEquipmentLoads.supplyMediumId))
    .where(and(buildLoadWhere(session, filters), countableLoadSql))
    .groupBy(fuelEquipmentLoads.month, fuelSupplyMedia.id, fuelSupplyMedia.name, fuelSupplyMedia.sortOrder)
    .orderBy(asc(fuelEquipmentLoads.month), asc(fuelSupplyMedia.sortOrder))
  return rows.map((row) => ({ ...row, liters: num(row.liters) }))
}

/* ── G-03 / G-04 / G-05: faena × medio, por unidad de rendimiento ────────── */

/**
 * Litros por faena y medio de los equipos de una unidad. Las filas vienen por
 * total de faena descendente; los rankings G-05 salen de los totales de esta
 * misma tabla para que ranking y tabla nunca discrepen.
 */
export async function getWorksiteMediumCrosstab(session: Session, filters: ControlFilters, unit: PerformanceUnit): Promise<Crosstab> {
  const liters = sql`sum(${fuelEquipmentLoads.liters})`
  const rows = await db.select({
    worksiteId: worksites.id,
    worksiteName: worksites.name,
    mediumId: fuelSupplyMedia.id,
    mediumName: fuelSupplyMedia.name,
    mediumOrder: fuelSupplyMedia.sortOrder,
    liters: sql<number>`${liters}::float8`,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelEquipmentLoads.worksiteId))
    .leftJoin(fuelSupplyMedia, eq(fuelSupplyMedia.id, fuelEquipmentLoads.supplyMediumId))
    .where(and(buildLoadWhere(session, filters), countableLoadSql, eq(fuelVehicles.performanceUnit, unit)))
    .groupBy(worksites.id, worksites.name, fuelSupplyMedia.id, fuelSupplyMedia.name, fuelSupplyMedia.sortOrder)
    .orderBy(desc(sql`sum(${liters}) over (partition by ${worksites.id})`), asc(worksites.name), asc(fuelSupplyMedia.sortOrder))
  return buildCrosstab(rows.map((row) => ({ ...row, liters: num(row.liters) })))
}

/* ── G-06 / G-07: serie mensual de medidor vs litros ─────────────────────── */

export interface MeterSeriesPoint {
  month: string
  /** Σ avance del medidor (km u horas) de los tramos calculados del mes. */
  measure: number
  /** Σ litros acumulados de esos mismos tramos. */
  liters: number
  /** Tramos (cargas con rendimiento calculado) que aportan al mes. */
  segments: number
}

export interface MeterSeries {
  unit: PerformanceUnit
  points: MeterSeriesPoint[]
  totalMeasure: number
  totalLiters: number
  /** km/L o L/h global del período: razón de sumas, no promedio de razones. */
  ratio: number | null
}

export async function getMeterSeries(session: Session, filters: ControlFilters): Promise<Record<PerformanceUnit, MeterSeries>> {
  const rows = await db.select({
    month: fuelEquipmentLoads.month,
    unit: fuelVehicles.performanceUnit,
    measure: sql<number>`coalesce(sum(${fuelEquipmentLoads.meterDelta}), 0)::float8`,
    liters: sql<number>`coalesce(sum(${fuelEquipmentLoads.accumulatedLiters}), 0)::float8`,
    segments: sql<number>`count(*)::int`,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(and(
      buildLoadWhere(session, filters),
      statisticallyValidLoadSql,
      sql`${fuelVehicles.performanceUnit} in ('km_per_liter', 'liters_per_hour')`,
    ))
    .groupBy(fuelEquipmentLoads.month, fuelVehicles.performanceUnit)
    .orderBy(asc(fuelEquipmentLoads.month))
  const build = (unit: PerformanceUnit): MeterSeries => {
    const points = rows.filter((row) => row.unit === unit).map((row) => ({
      month: row.month, measure: num(row.measure), liters: num(row.liters), segments: num(row.segments),
    }))
    const totalMeasure = points.reduce((sum, point) => sum + point.measure, 0)
    const totalLiters = points.reduce((sum, point) => sum + point.liters, 0)
    return { unit, points, totalMeasure, totalLiters, ratio: globalRatio(unit, totalMeasure, totalLiters) }
  }
  return { km_per_liter: build("km_per_liter"), liters_per_hour: build("liters_per_hour") }
}

/** ¿Hay alguna carga proyectada en el alcance del usuario (sin filtros)? Distingue «sin datos» de «sin coincidencias». */
export async function hasAnyLoads(session: Session): Promise<boolean> {
  const rows = await db.select({ id: fuelEquipmentLoads.id }).from(fuelEquipmentLoads)
    .where(worksiteScopeSql(session, fuelEquipmentLoads.worksiteId))
    .limit(1)
  return rows.length > 0
}

import type { Session } from "next-auth"
import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelEquipmentTypes, fuelVehicles, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import type { PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { buildLoadWhere, chileDateSql, countableLoadSql, statisticallyValidLoadSql, type ControlFilters } from "@/lib/combustibles/control/filters"
import { coefficientOfVariation, deltaPct, isWorsePerformance, periodStartPlainDate, shiftPlainDateByMonths } from "@/lib/combustibles/control/view-helpers"
import { resolvePagination, type PaginationState } from "@/lib/pagination"
import { toNullableNumber, toNumber } from "./shared"

/**
 * Consultas de las vistas de rendimiento por familia (R-01 a R-06). Promedio y
 * desviación se calculan en SQL (`avg`, `stddev_samp`) sobre cargas con
 * rendimiento calculado y sin revisión pendiente. Las unidades nunca se mezclan:
 * todo agrupa por la unidad del equipo.
 */

export const DETAIL_PAGE_SIZE = 50
export const EXPORT_ROW_LIMIT = 10_000
const MEASURABLE_UNITS = sql`${fuelVehicles.performanceUnit} in ('km_per_liter', 'liters_per_hour')`

/* ── R-02: por faena ─────────────────────────────────────────────────────── */

export interface WorksiteStatRow {
  worksiteId: string
  worksiteName: string
  unit: PerformanceUnit
  n: number
  mean: number | null
  /** Desviación estándar muestral; null con n < 2. */
  sd: number | null
  /** Coeficiente de variación (σ ÷ media); null si no se puede calcular. */
  cv: number | null
}

export async function getWorksiteStats(session: Session, filters: ControlFilters): Promise<WorksiteStatRow[]> {
  const perf = fuelEquipmentLoads.performanceValue
  const rows = await db.select({
    worksiteId: worksites.id,
    worksiteName: worksites.name,
    unit: fuelVehicles.performanceUnit,
    n: sql<number>`count(*)::int`,
    mean: sql<number | null>`avg(${perf})::float8`,
    sd: sql<number | null>`stddev_samp(${perf})::float8`,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelEquipmentLoads.worksiteId))
    .where(and(buildLoadWhere(session, filters), statisticallyValidLoadSql, MEASURABLE_UNITS))
    .groupBy(worksites.id, worksites.name, fuelVehicles.performanceUnit)
    .orderBy(asc(worksites.name), asc(fuelVehicles.performanceUnit))
  return rows.map((row) => {
    const mean = toNullableNumber(row.mean)
    const sd = toNullableNumber(row.sd)
    return {
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName,
      unit: row.unit as PerformanceUnit,
      n: toNumber(row.n),
      mean,
      sd,
      cv: coefficientOfVariation(mean, sd),
    }
  })
}

/** Cargas en revisión con rendimiento calculado: no entran al promedio ni a σ. Por unidad. */
export async function getReviewExclusions(session: Session, filters: ControlFilters): Promise<Record<PerformanceUnit, number>> {
  const rows = await db.select({
    unit: fuelVehicles.performanceUnit,
    n: sql<number>`count(*)::int`,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(and(
      buildLoadWhere(session, filters),
      countableLoadSql,
      eq(fuelEquipmentLoads.reviewStatus, "flagged"),
      eq(fuelEquipmentLoads.performanceStatus, "computed"),
      MEASURABLE_UNITS,
    ))
    .groupBy(fuelVehicles.performanceUnit)
  const byUnit = new Map(rows.map((row) => [row.unit, toNumber(row.n)]))
  return { km_per_liter: byUnit.get("km_per_liter") ?? 0, liters_per_hour: byUnit.get("liters_per_hour") ?? 0 }
}

/* ── R-03 + R-06: por equipo ─────────────────────────────────────────────── */

export interface EquipmentStatRow {
  vehicleId: string
  worksiteName: string | null
  code: string | null
  plate: string
  brand: string | null
  model: string | null
  equipmentType: string | null
  unit: PerformanceUnit
  n: number
  mean: number | null
  sd: number | null
  /** Promedio de los demás equipos de igual marca, modelo y unidad, con los mismos filtros. */
  modelMean: number | null
  deltaModelPct: number | null
  /** Promedio de las cargas válidas del equipo en los 12 meses previos al período. */
  historyMean: number | null
  deltaHistoryPct: number | null
  /** Se aleja más de 10 % de su modelo o de su histórico en la dirección mala. */
  worseThanModel: boolean
  worseThanHistory: boolean
}

export interface EquipmentStatsPage {
  rows: EquipmentStatRow[]
  pagination: PaginationState
}

/**
 * Una fila por equipo con cargas contables en el período. El promedio del modelo
 * se calcula como (Σ del modelo − Σ propia) ÷ (n del modelo − n propia): excluye
 * al equipo sin una segunda pasada. El equipo (`filters.equipment`) solo acota
 * la lista, NO el cálculo del modelo.
 */
export async function getEquipmentStats(
  session: Session,
  filters: ControlFilters,
  options: { page?: number; pageSize?: number; all?: boolean } = {},
): Promise<EquipmentStatsPage> {
  const perf = fuelEquipmentLoads.performanceValue
  const base = buildLoadWhere(session, { ...filters, equipment: undefined })
  const periodStart = periodStartPlainDate(filters)
  const historyStart = shiftPlainDateByMonths(periodStart, -12)
  const scope = worksiteScopeSql(session, fuelEquipmentLoads.worksiteId)

  const pv = db.$with("pv").as(
    db.select({
      vehicleId: fuelVehicles.id,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      brand: fuelVehicles.brand,
      model: fuelVehicles.model,
      unit: fuelVehicles.performanceUnit,
      typeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("type_name"),
      worksiteName: sql<string | null>`${worksites.name}`.as("worksite_name"),
      modelKey: sql<string | null>`case when nullif(trim(${fuelVehicles.brand}), '') is null or nullif(trim(${fuelVehicles.model}), '') is null then null else lower(trim(${fuelVehicles.brand})) || '|' || lower(trim(${fuelVehicles.model})) || '|' || ${fuelVehicles.performanceUnit} end`.as("model_key"),
      n: sql<number>`(count(*) filter (where ${statisticallyValidLoadSql}))::int`.as("n"),
      sumPerf: sql<number>`coalesce(sum(${perf}) filter (where ${statisticallyValidLoadSql}), 0)::float8`.as("sum_perf"),
      sd: sql<number | null>`(stddev_samp(${perf}) filter (where ${statisticallyValidLoadSql}))::float8`.as("sd"),
    })
      .from(fuelEquipmentLoads)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
      .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
      .leftJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
      .where(and(base, countableLoadSql, MEASURABLE_UNITS))
      .groupBy(fuelVehicles.id, fuelEquipmentTypes.name, worksites.name),
  )
  const mk = db.$with("mk").as(
    db.select({
      modelKey: sql<string | null>`${pv.modelKey}`.as("mk_model_key"),
      n: sql<number>`sum(${pv.n})`.as("mk_n"),
      sumPerf: sql<number>`sum(${pv.sumPerf})`.as("mk_sum"),
    }).from(pv).groupBy(pv.modelKey),
  )

  const needle = filters.equipment?.toLowerCase()
  // Coincidencia exacta de código o patente: el filtro llega del selector de equipos, no de un texto libre.
  const equipmentPredicate = needle ? sql`(lower(${pv.code}) = ${needle} or lower(${pv.plate}) = ${needle})` : undefined

  const [{ total } = { total: 0 }] = await db.with(pv).select({ total: sql<number>`count(*)::int` }).from(pv).where(equipmentPredicate)
  const pagination = options.all
    ? resolvePagination({ pageParam: "1", totalItems: toNumber(total), pageSize: EXPORT_ROW_LIMIT })
    : resolvePagination({ pageParam: String(options.page ?? filters.page), totalItems: toNumber(total), pageSize: options.pageSize ?? DETAIL_PAGE_SIZE })

  const rows = await db.with(pv, mk).select({
    vehicleId: pv.vehicleId,
    code: pv.code,
    plate: pv.plate,
    brand: pv.brand,
    model: pv.model,
    unit: pv.unit,
    typeName: pv.typeName,
    worksiteName: pv.worksiteName,
    n: pv.n,
    mean: sql<number | null>`case when ${pv.n} > 0 then (${pv.sumPerf} / ${pv.n})::float8 else null end`,
    sd: pv.sd,
    modelMean: sql<number | null>`case when ${pv.modelKey} is null or coalesce(${mk.n}, 0) - ${pv.n} <= 0 then null else ((${mk.sumPerf} - ${pv.sumPerf}) / (${mk.n} - ${pv.n}))::float8 end`,
    historyMean: sql<number | null>`(
      select avg(${fuelEquipmentLoads.performanceValue})::float8 from ${fuelEquipmentLoads}
      where ${fuelEquipmentLoads.vehicleId} = ${pv.vehicleId}
        and ${statisticallyValidLoadSql}
        ${scope ? sql`and ${scope}` : sql``}
        and ${chileDateSql(fuelEquipmentLoads.occurredAt)} >= ${historyStart}::date
        and ${chileDateSql(fuelEquipmentLoads.occurredAt)} < ${periodStart}::date
    )`,
  })
    .from(pv)
    .leftJoin(mk, eq(mk.modelKey, pv.modelKey))
    .where(equipmentPredicate)
    .orderBy(asc(pv.worksiteName), sql`${pv.code} asc nulls last`, asc(pv.plate))
    .limit(pagination.limit)
    .offset(pagination.offset)

  return {
    pagination,
    rows: rows.map((row) => {
      const unit = row.unit as PerformanceUnit
      const mean = toNullableNumber(row.mean)
      const modelMean = toNullableNumber(row.modelMean)
      const historyMean = toNullableNumber(row.historyMean)
      const deltaModel = deltaPct(mean, modelMean)
      const deltaHistory = deltaPct(mean, historyMean)
      return {
        vehicleId: row.vehicleId,
        worksiteName: row.worksiteName,
        code: row.code,
        plate: row.plate,
        brand: row.brand,
        model: row.model,
        equipmentType: row.typeName,
        unit,
        n: toNumber(row.n),
        mean,
        sd: toNullableNumber(row.sd),
        modelMean,
        deltaModelPct: deltaModel,
        historyMean,
        deltaHistoryPct: deltaHistory,
        worseThanModel: isWorsePerformance(unit, deltaModel),
        worseThanHistory: isWorsePerformance(unit, deltaHistory),
      }
    }),
  }
}

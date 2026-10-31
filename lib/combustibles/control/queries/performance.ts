import type { Session } from "next-auth"
import { and, asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelEquipmentTypes, fuelVehicles, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import type { PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { buildLoadWhere, chileDateSql, countableLoadSql, statisticallyValidLoadSql, type ControlFilters } from "@/lib/combustibles/control/filters"
import { WORSE_PERFORMANCE_THRESHOLD_PCT, coefficientOfVariation, deltaPct, isWorsePerformance, periodStartPlainDate, shiftPlainDateByMonths } from "@/lib/combustibles/control/view-helpers"
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
  /** Coeficiente de variación de sus cargas (σ ÷ promedio); null con menos de 2 cargas válidas. */
  cv: number | null
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
 * Las dos CTE que comparten la lista por equipo y el conteo de «rinde peor»
 * (`getEquipmentWorseSummary`): una fila por equipo con cargas contables en el
 * período (`pv`) y los totales por modelo (`mk`). Una sola definición para que
 * la lista y el contador del Panel jamás discrepen.
 *
 * El promedio del modelo se calcula como (Σ del modelo − Σ propia) ÷ (n del
 * modelo − n propia): excluye al equipo sin una segunda pasada.
 */
function equipmentCtes(session: Session, filters: ControlFilters) {
  const perf = fuelEquipmentLoads.performanceValue
  // El equipo (`filters.equipment`) solo acota la lista, NO el cálculo del modelo.
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
      family: sql<string | null>`${fuelEquipmentTypes.performanceFamily}`.as("family"),
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
      .groupBy(fuelVehicles.id, fuelEquipmentTypes.name, fuelEquipmentTypes.performanceFamily, worksites.name),
  )
  const mk = db.$with("mk").as(
    db.select({
      modelKey: sql<string | null>`${pv.modelKey}`.as("mk_model_key"),
      n: sql<number>`sum(${pv.n})`.as("mk_n"),
      sumPerf: sql<number>`sum(${pv.sumPerf})`.as("mk_sum"),
    }).from(pv).groupBy(pv.modelKey),
  )

  const meanSql = sql<number | null>`case when ${pv.n} > 0 then (${pv.sumPerf} / ${pv.n})::float8 else null end`
  const modelMeanSql = sql<number | null>`case when ${pv.modelKey} is null or coalesce(${mk.n}, 0) - ${pv.n} <= 0 then null else ((${mk.sumPerf} - ${pv.sumPerf}) / (${mk.n} - ${pv.n}))::float8 end`
  const historyMeanSql = sql<number | null>`(
      select avg(${fuelEquipmentLoads.performanceValue})::float8 from ${fuelEquipmentLoads}
      where ${fuelEquipmentLoads.vehicleId} = ${pv.vehicleId}
        and ${statisticallyValidLoadSql}
        ${scope ? sql`and ${scope}` : sql``}
        and ${chileDateSql(fuelEquipmentLoads.occurredAt)} >= ${historyStart}::date
        and ${chileDateSql(fuelEquipmentLoads.occurredAt)} < ${periodStart}::date
    )`

  return { pv, mk, meanSql, modelMeanSql, historyMeanSql }
}

/**
 * Una fila por equipo con cargas contables en el período. El equipo
 * (`filters.equipment`) solo acota la lista, NO el cálculo del modelo.
 */
export async function getEquipmentStats(
  session: Session,
  filters: ControlFilters,
  options: { page?: number; pageSize?: number; all?: boolean } = {},
): Promise<EquipmentStatsPage> {
  const { pv, mk, meanSql, modelMeanSql, historyMeanSql } = equipmentCtes(session, filters)

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
    mean: meanSql,
    sd: pv.sd,
    modelMean: modelMeanSql,
    historyMean: historyMeanSql,
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
      const sd = toNullableNumber(row.sd)
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
        sd,
        cv: coefficientOfVariation(mean, sd),
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

/* ── «Rinde peor»: cuántos equipos y cuáles, calculado en SQL ─────────────── */

export interface WorseEquipmentExample {
  vehicleId: string
  code: string | null
  plate: string
  /** Familia de rendimiento del equipo (`PerformanceFamily`) o null si su tipo no la tiene. */
  family: string | null
  typeName: string | null
  unit: PerformanceUnit
  /** La diferencia más mala de las dos (contra su modelo o contra su historial), en %. */
  deltaPct: number
  /** Contra qué se mide `deltaPct`. */
  against: "model" | "history"
}

export interface EquipmentWorseSummary {
  /** Equipos con cargas contables y rendimiento medible en el período y los filtros. */
  total: number
  /** Los que rinden más de 10 % peor que su modelo O que su propio historial. */
  worse: number
  worseThanModel: number
  worseThanHistory: number
  /** Los peores `limit`, del más lejano al menos. */
  examples: WorseEquipmentExample[]
}

/**
 * Cuántos equipos rinden más de 10 % peor que su modelo o que su historial de
 * 12 meses (km/L: menos es peor; L/h: más es peor), todo en SQL y sin paginar:
 * la lista de `getEquipmentStats` calcula la marca en JS sobre una página, y el
 * Panel necesita el total de todo el alcance. No cuentan cargas por decidir,
 * rechazadas, anuladas ni duplicadas (`statisticallyValidLoadSql`).
 */
export async function getEquipmentWorseSummary(session: Session, filters: ControlFilters, limit = 3): Promise<EquipmentWorseSummary> {
  const { pv, mk, meanSql, modelMeanSql, historyMeanSql } = equipmentCtes(session, filters)
  const threshold = WORSE_PERFORMANCE_THRESHOLD_PCT

  const cmp = db.$with("cmp").as(
    db.select({
      vehicleId: pv.vehicleId,
      code: pv.code,
      plate: pv.plate,
      unit: pv.unit,
      typeName: pv.typeName,
      family: pv.family,
      mean: meanSql.as("mean"),
      modelMean: modelMeanSql.as("model_mean"),
      historyMean: historyMeanSql.as("history_mean"),
    }).from(pv).leftJoin(mk, eq(mk.modelKey, pv.modelKey)),
  )
  const delta = (reference: typeof cmp.modelMean) =>
    sql<number | null>`case when ${cmp.mean} is not null and ${reference} > 0 then ((${cmp.mean} - ${reference}) / ${reference} * 100)::float8 else null end`
  const scored = db.$with("scored").as(
    db.select({
      vehicleId: cmp.vehicleId,
      code: cmp.code,
      plate: cmp.plate,
      unit: cmp.unit,
      typeName: cmp.typeName,
      family: cmp.family,
      deltaModel: delta(cmp.modelMean).as("delta_model"),
      deltaHistory: delta(cmp.historyMean).as("delta_history"),
    }).from(cmp),
  )
  // «Peor» según la dirección de cada unidad: km/L baja, L/h sube.
  const badness = (column: typeof scored.deltaModel) =>
    sql<number | null>`case when ${column} is null then null when ${scored.unit} = 'km_per_liter' then -${column} else ${column} end`
  const badModel = badness(scored.deltaModel)
  const badHistory = badness(scored.deltaHistory)
  const worseModel = sql<boolean>`coalesce(${badModel} > ${threshold}, false)`
  const worseHistory = sql<boolean>`coalesce(${badHistory} > ${threshold}, false)`

  const [totals, examples] = await Promise.all([
    db.with(pv, mk, cmp, scored).select({
      total: sql<number>`count(*)::int`,
      worse: sql<number>`(count(*) filter (where ${worseModel} or ${worseHistory}))::int`,
      worseModel: sql<number>`(count(*) filter (where ${worseModel}))::int`,
      worseHistory: sql<number>`(count(*) filter (where ${worseHistory}))::int`,
    }).from(scored),
    limit > 0
      ? db.with(pv, mk, cmp, scored).select({
        vehicleId: scored.vehicleId,
        code: scored.code,
        plate: scored.plate,
        unit: scored.unit,
        typeName: scored.typeName,
        family: scored.family,
        deltaModel: scored.deltaModel,
        deltaHistory: scored.deltaHistory,
      }).from(scored)
        .where(sql`${worseModel} or ${worseHistory}`)
        // `greatest` ignora los nulos: si solo hay una comparación, esa manda.
        .orderBy(sql`greatest(${badModel}, ${badHistory}) desc`, sql`${scored.code} asc nulls last`, asc(scored.plate))
        .limit(limit)
      : Promise.resolve([]),
  ])

  const row = totals[0]
  return {
    total: toNumber(row?.total),
    worse: toNumber(row?.worse),
    worseThanModel: toNumber(row?.worseModel),
    worseThanHistory: toNumber(row?.worseHistory),
    examples: examples.map((example) => {
      const unit = example.unit as PerformanceUnit
      const deltaModel = toNullableNumber(example.deltaModel)
      const deltaHistory = toNullableNumber(example.deltaHistory)
      const bad = (value: number | null) => (value === null ? Number.NEGATIVE_INFINITY : unit === "km_per_liter" ? -value : value)
      const againstModel = bad(deltaModel) >= bad(deltaHistory)
      return {
        vehicleId: example.vehicleId,
        code: example.code,
        plate: example.plate,
        family: example.family,
        typeName: example.typeName,
        unit,
        deltaPct: (againstModel ? deltaModel : deltaHistory) ?? 0,
        against: againstModel ? "model" : "history",
      }
    }),
  }
}

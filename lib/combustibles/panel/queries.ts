import "server-only"
import type { Session } from "next-auth"
import { and, desc, eq, inArray, isNull, ne, sql, type AnyColumn } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelEquipmentLoads,
  fuelEquipmentTypes,
  fuelLoads,
  fuelMonthlyStatements,
  fuelOperationBatches,
  fuelTaeSubmissions,
  fuelVehicles,
  worksites,
} from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { buildLoadWhere, countableLoadSql, statisticallyValidLoadSql, type ControlFilters } from "@/lib/combustibles/control/filters"
import { FUEL_LOAD_STATE_SLUGS } from "@/lib/combustibles/fuel-log-shared"
import { fuelPeriodBounds, previousFuelPeriods } from "@/lib/combustibles/period/parse"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { elapsedPeriodDays } from "./format"
import { HISTORY_PERIODS, type PanelFigureBucket, type PanelFiguresRaw } from "./figures"

/**
 * Consultas propias del Panel de combustible: las cifras del período y lo que
 * sólo existe en las variantes de terreno y contrato (mis cargas, mi última
 * planilla, mis equipos). Lo demás (bandeja, fuentes, cuadratura, equipos que
 * rinden peor, pagos) viene de las funciones de cada pantalla.
 *
 * Todas las consultas respetan el alcance por faena de la sesión
 * (`worksiteScopeSql`) y miden el período con el día civil de Chile, la misma
 * ventana que usan las listas a las que enlaza el Panel.
 */

const num = (value: unknown): number => Number(value ?? 0)

/** Día civil de Chile de un `timestamptz`. */
const chileDate = (column: AnyColumn) => sql`(${column} AT TIME ZONE 'America/Santiago')::date`

/** Filtros del control con el rango del período, para reutilizar `buildLoadWhere` (alcance + ventana). */
function rangeFilters(from: string, to: string): ControlFilters {
  return { year: Number(from.slice(0, 4)), months: [], from, to, page: 1 }
}

/* ── Las tres cifras ──────────────────────────────────────────────────────── */

/**
 * Sumas por período de los últimos `HISTORY_PERIODS` (el actual y los cuatro
 * anteriores del mismo tipo y largo), en una sola pasada: cada carga cae en el
 * período que contiene su día. Litros y equipos cuentan toda carga que cuenta
 * (`countableLoadSql`: las que esperan decisión suman litros porque el
 * combustible se cargó); los promedios usan sólo tramos con rendimiento
 * calculado y sin decisión pendiente (`statisticallyValidLoadSql`), así que una
 * carga por decidir o una que «no cuenta» nunca entra a un km/L ni a un L/h.
 *
 * Camiones es la familia `camiones` con km/L; maquinaria, la familia
 * `maquinaria` con L/h (las mismas familias de «Consumo y rendimiento»).
 */
export async function getPanelFigures(session: Session, resolved: ResolvedFuelPeriod, today = todayInChile()): Promise<PanelFiguresRaw> {
  const periods = previousFuelPeriods(resolved.period, HISTORY_PERIODS).map((period) => fuelPeriodBounds(period))
  const first = periods[0]
  const last = periods[periods.length - 1]
  const previous = periods[periods.length - 2]
  if (!first || !last || !previous) throw new Error("El Panel necesita al menos dos períodos para comparar")

  const day = chileDate(fuelEquipmentLoads.occurredAt)
  const bucketOf = sql<number>`case ${sql.join(
    periods.map((period, index) => sql`when ${day} between ${period.from}::date and ${period.to}::date then ${index}::int`),
    sql` `,
  )} end`

  const truck = and(eq(fuelEquipmentTypes.performanceFamily, "camiones"), eq(fuelVehicles.performanceUnit, "km_per_liter"))!
  const machine = and(eq(fuelEquipmentTypes.performanceFamily, "maquinaria"), eq(fuelVehicles.performanceUnit, "liters_per_hour"))!
  const validTruck = and(statisticallyValidLoadSql, truck)!
  const validMachine = and(statisticallyValidLoadSql, machine)!
  const pendingComputed = and(countableLoadSql, eq(fuelEquipmentLoads.reviewStatus, "flagged"), eq(fuelEquipmentLoads.performanceStatus, "computed"))!

  // El período en curso se compara contra los mismos primeros días del anterior: contra el mes entero
  // mostraría una caída que no existe. El final de ese tramo se acota al último día del anterior.
  const elapsed = resolved.status === "en_curso" ? elapsedPeriodDays(resolved.from, resolved.to, today) : 0
  const partialEnd = elapsed > 0 ? minDate(previous.to, addDaysToPlainDate(previous.from, elapsed - 1)) : null
  const partialPrev = partialEnd
    ? sql<number>`coalesce(sum(${fuelEquipmentLoads.liters}) filter (where ${countableLoadSql} and ${day} between ${previous.from}::date and ${partialEnd}::date), 0)::float8`
    : sql<number>`0::float8`

  const rows = await db.select({
    bucket: bucketOf,
    liters: sql<number>`coalesce(sum(${fuelEquipmentLoads.liters}) filter (where ${countableLoadSql}), 0)::float8`,
    loads: sql<number>`(count(*) filter (where ${countableLoadSql}))::int`,
    equipment: sql<number>`(count(distinct ${fuelEquipmentLoads.vehicleId}) filter (where ${countableLoadSql}))::int`,
    truckKm: sql<number>`coalesce(sum(${fuelEquipmentLoads.meterDelta}) filter (where ${validTruck}), 0)::float8`,
    truckLiters: sql<number>`coalesce(sum(${fuelEquipmentLoads.accumulatedLiters}) filter (where ${validTruck}), 0)::float8`,
    truckExcluded: sql<number>`(count(*) filter (where ${pendingComputed} and ${truck}))::int`,
    machineHours: sql<number>`coalesce(sum(${fuelEquipmentLoads.meterDelta}) filter (where ${validMachine}), 0)::float8`,
    machineLiters: sql<number>`coalesce(sum(${fuelEquipmentLoads.accumulatedLiters}) filter (where ${validMachine}), 0)::float8`,
    machineExcluded: sql<number>`(count(*) filter (where ${pendingComputed} and ${machine}))::int`,
    partialPrev,
  }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(buildLoadWhere(session, rangeFilters(first.from, last.to)))
    // Por posición: repetir la expresión con parámetros nuevos en el GROUP BY no la reconoce como la del SELECT.
    .groupBy(sql`1`)

  const byBucket = new Map(rows.map((row) => [num(row.bucket), row]))
  const buckets = periods.map((period, index): PanelFigureBucket => {
    const row = byBucket.get(index)
    return {
      from: period.from,
      to: period.to,
      liters: num(row?.liters),
      loads: num(row?.loads),
      equipment: num(row?.equipment),
      truckKm: num(row?.truckKm),
      truckLiters: num(row?.truckLiters),
      truckExcluded: num(row?.truckExcluded),
      machineHours: num(row?.machineHours),
      machineLiters: num(row?.machineLiters),
      machineExcluded: num(row?.machineExcluded),
    }
  })
  const previousIndex = periods.length - 2
  return {
    buckets,
    partialPrevLiters: partialEnd ? num(byBucket.get(previousIndex)?.partialPrev) : null,
  }
}

function minDate(a: string, b: string): string {
  return a <= b ? a : b
}

/**
 * ¿Hay en el período alguna carga con rendimiento calculado y sin decisión
 * pendiente, de cualquier familia? Distingue «ningún equipo rinde peor» de «no
 * hay con qué medirlo» (el paso 4 no puede decir «Ninguno» sin cargas medibles).
 */
export async function hasMeasuredPerformance(session: Session, resolved: ResolvedFuelPeriod): Promise<boolean> {
  const rows = await db.select({ id: fuelEquipmentLoads.id }).from(fuelEquipmentLoads)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(and(
      buildLoadWhere(session, rangeFilters(resolved.from, resolved.to)),
      statisticallyValidLoadSql,
      sql`${fuelVehicles.performanceUnit} in ('km_per_liter', 'liters_per_hour')`,
    ))
    .limit(1)
  return rows.length > 0
}

/* ── Pagos: ¿hay algo facturado? ──────────────────────────────────────────── */

/**
 * Estados de cuenta y cargas facturadas de los meses que toca el período. Un
 * resumen de pagos vacío significa «todo pagado» sólo si hubo algo que pagar;
 * sin facturas ni estados el paso no puede decir «Al día» (`steps.ts`). Es
 * información de montos: sólo se llama con el contrato monetario global.
 */
export async function getPaymentActivity(resolved: ResolvedFuelPeriod): Promise<{ statements: number; invoicedLoads: number }> {
  const months = resolved.monthKeys
  const [statements, loads] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(fuelMonthlyStatements)
      .where(and(inArray(fuelMonthlyStatements.month, months), ne(fuelMonthlyStatements.status, "cancelled"))),
    db.select({ total: sql<number>`count(*)::int` }).from(fuelLoads)
      .where(and(inArray(fuelLoads.month, months), ne(fuelLoads.status, "cancelled"))),
  ])
  return { statements: num(statements[0]?.total), invoicedLoads: num(loads[0]?.total) }
}

/* ── Terreno y contrato: lo mío ───────────────────────────────────────────── */

/** Cargas registradas por la persona desde la app en la ventana del período, y alcance de faena vigente. */
function myLoadsWhere(session: Session, resolved: ResolvedFuelPeriod) {
  return and(
    eq(fuelTaeSubmissions.registeredBy, session.user.id),
    worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
    sql`${chileDate(fuelTaeSubmissions.loadedAt)} between ${resolved.from}::date and ${resolved.to}::date`,
  )
}

export interface MyLoadCounts {
  /** Sin contar las anuladas. */
  all: number
  toValidate: number
  withObservation: number
}

export async function getMyLoadCounts(session: Session, resolved: ResolvedFuelPeriod): Promise<MyLoadCounts> {
  const status = fuelTaeSubmissions.status
  const [row] = await db.select({
    all: sql<number>`(count(*) filter (where ${status} <> ${FUEL_LOAD_STATE_SLUGS.anulada.tae}))::int`,
    toValidate: sql<number>`(count(*) filter (where ${status} = ${FUEL_LOAD_STATE_SLUGS["por-validar"].tae}))::int`,
    withObservation: sql<number>`(count(*) filter (where ${status} = ${FUEL_LOAD_STATE_SLUGS["con-observacion"].tae}))::int`,
  }).from(fuelTaeSubmissions).where(myLoadsWhere(session, resolved))
  return { all: num(row?.all), toValidate: num(row?.toValidate), withObservation: num(row?.withObservation) }
}

export interface MyRecentLoad {
  /** Id de la carga en terreno: `fuelLoadHref({ origen: "terreno", id })`. */
  id: string
  loadedAt: string
  equipmentCode: string
  plate: string | null
  worksiteName: string | null
  liters: number
  status: string
}

export async function getMyRecentLoads(session: Session, resolved: ResolvedFuelPeriod, limit = 5): Promise<MyRecentLoad[]> {
  const rows = await db.select({
    id: fuelTaeSubmissions.id,
    loadedAt: fuelTaeSubmissions.loadedAt,
    equipmentCode: fuelTaeSubmissions.equipmentCodeSnapshot,
    plate: fuelTaeSubmissions.plateSnapshot,
    worksiteName: worksites.name,
    liters: fuelTaeSubmissions.liters,
    status: fuelTaeSubmissions.status,
  }).from(fuelTaeSubmissions)
    .leftJoin(worksites, eq(worksites.id, fuelTaeSubmissions.worksiteId))
    .where(and(myLoadsWhere(session, resolved), ne(fuelTaeSubmissions.status, FUEL_LOAD_STATE_SLUGS.anulada.tae)))
    .orderBy(desc(fuelTaeSubmissions.loadedAt), desc(fuelTaeSubmissions.id))
    .limit(limit)
  return rows.map((row) => ({ ...row, liters: num(row.liters) }))
}

/**
 * Identificadores de mis cargas que esperan decisión (la carga y su registro en
 * terreno): sirven para reconocer, en la bandeja, lo que a la persona le toca
 * corregir aunque no pueda decidirlo. Sin ventana de período: lo que sigue
 * pendiente sigue siendo suyo.
 */
export async function getMyFlaggedLoadKeys(session: Session, limit = 200): Promise<string[]> {
  const rows = await db.select({ loadId: fuelEquipmentLoads.id, submissionId: fuelEquipmentLoads.taeSubmissionId })
    .from(fuelEquipmentLoads)
    .innerJoin(fuelTaeSubmissions, eq(fuelTaeSubmissions.id, fuelEquipmentLoads.taeSubmissionId))
    .where(and(
      eq(fuelTaeSubmissions.registeredBy, session.user.id),
      worksiteScopeSql(session, fuelEquipmentLoads.worksiteId),
      eq(fuelEquipmentLoads.reviewStatus, "flagged"),
      isNull(fuelEquipmentLoads.voidedAt),
    ))
    .limit(limit)
  return rows.flatMap((row) => (row.submissionId ? [row.loadId, row.submissionId] : [row.loadId]))
}

export interface MyEquipmentLiters {
  vehicleId: string
  label: string
  liters: number
}

/** Litros por equipo en las faenas de la persona (su alcance), de mayor a menor. */
export async function getMyEquipmentRanking(session: Session, resolved: ResolvedFuelPeriod, limit = 8): Promise<MyEquipmentLiters[]> {
  const liters = sql<number>`sum(${fuelEquipmentLoads.liters})::float8`
  const rows = await db.select({
    vehicleId: fuelVehicles.id,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    worksiteName: worksites.name,
    liters,
  }).from(fuelEquipmentLoads)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .where(and(buildLoadWhere(session, rangeFilters(resolved.from, resolved.to)), countableLoadSql))
    .groupBy(fuelVehicles.id, fuelVehicles.code, fuelVehicles.plate, worksites.name)
    .orderBy(desc(liters), fuelVehicles.id)
    .limit(limit)
  return rows.map((row) => ({
    vehicleId: row.vehicleId,
    label: `${row.code ?? row.plate}${row.worksiteName ? ` · ${row.worksiteName}` : ""}`,
    liters: num(row.liters),
  }))
}

export interface MyLastPlanillaBatch {
  id: string
  fileName: string
  importedAt: string
  validRows: number
  invalidRows: number
}

/** La última planilla de cargas que importó la persona y que sigue vigente (no revertida). */
export async function getMyLastPlanillaBatch(session: Session): Promise<MyLastPlanillaBatch | null> {
  const [row] = await db.select({
    id: fuelOperationBatches.id,
    fileName: fuelOperationBatches.archivoNombre,
    importedAt: fuelOperationBatches.createdAt,
    validRows: fuelOperationBatches.filasValidas,
    invalidRows: fuelOperationBatches.filasInvalidas,
  }).from(fuelOperationBatches)
    .where(and(eq(fuelOperationBatches.importadoPor, session.user.id), eq(fuelOperationBatches.estado, "importado")))
    .orderBy(desc(fuelOperationBatches.createdAt), desc(fuelOperationBatches.id))
    .limit(1)
  return row ? { ...row, validRows: num(row.validRows), invalidRows: num(row.invalidRows) } : null
}

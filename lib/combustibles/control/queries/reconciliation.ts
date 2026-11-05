import type { Session } from "next-auth"
import { and, asc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fuelMandanteWorksites, fuelMandantes, fuelProviderTransactions, fuelSupplyInputs, fuelSupplyMedia, fuelTaeLoadingPoints, fuelTaeSubmissions, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { reconcile } from "../calc/reconciliation"
import { deliveryModeFor, type LoadingPointType } from "../contracts"
import { accountableProviderTransactionsWhere } from "@/lib/combustibles/load-status"
import { mandanteWorksitesSql, type ControlFilters } from "../filters"
import { chileMonthSql, isoTextMonthSql, isoTextPeriodSql, submissionWhere, timestampPeriodSql } from "./field-filters"

/**
 * Conciliación por mandante (C-02) y cruce por medio de suministro (C-03).
 * Entrada = entradas importadas + libro de proveedores mapeado a un medio.
 * Entregado = cargas de terreno no anuladas, separadas por el tipo de lugar de
 * carga (supuesto S-3).
 *
 * Los tres lados se agrupan por el **mismo calendario**: el mes civil chileno.
 * La entrada importada ya trae su `month` chileno; el libro del proveedor y las
 * entregas se convierten a hora de Chile antes de cortar el mes. Antes el
 * proveedor se agrupaba por el texto UTC (`left(occurred_at, 7)`) y una
 * transacción del 31-mar 22:10 de Chile —`2026-04-01T01:10Z`— caía en abril
 * mientras su entrega quedaba en marzo (hallazgo 3.3).
 */

export interface MandanteInfo {
  id: string
  name: string
  tolerancePct: number
  worksiteNames: string[]
}

export async function getMandante(mandanteId: string): Promise<MandanteInfo | null> {
  const [mandante] = await db.select({ id: fuelMandantes.id, name: fuelMandantes.name, tolerancePct: fuelMandantes.tolerancePct })
    .from(fuelMandantes).where(and(eq(fuelMandantes.id, mandanteId), eq(fuelMandantes.isActive, true))).limit(1)
  if (!mandante) return null
  const sites = await db.select({ name: worksites.name }).from(fuelMandanteWorksites)
    .innerJoin(worksites, eq(worksites.id, fuelMandanteWorksites.worksiteId))
    .where(eq(fuelMandanteWorksites.mandanteId, mandanteId)).orderBy(asc(worksites.name))
  return { ...mandante, worksiteNames: sites.map((site) => site.name) }
}

function scopeConditions(session: Session | null, filters: ControlFilters, worksiteColumn: AnyColumn): SQL | undefined {
  return and(
    worksiteScopeSql(session, worksiteColumn, filters.worksiteId),
    filters.mandanteId ? sql`${worksiteColumn} in ${mandanteWorksitesSql(filters.mandanteId)}` : undefined,
  )
}

function inputsWhere(session: Session | null, filters: ControlFilters): SQL {
  return and(
    scopeConditions(session, filters, fuelSupplyInputs.worksiteId),
    timestampPeriodSql(filters, fuelSupplyInputs.occurredAt, fuelSupplyInputs.month),
  ) ?? sql`true`
}

/**
 * Transacciones del proveedor aceptadas y vigentes en el alcance y período. La
 * regla de qué cuenta (aceptadas, no reemplazadas, sin doble conteo del agregado
 * mensual TCT) es `accountableProviderTransactionsWhere`, compartida con Analítica.
 */
function providerWhere(session: Session | null, filters: ControlFilters): SQL {
  const t = fuelProviderTransactions
  return and(
    accountableProviderTransactionsWhere(),
    scopeConditions(session, filters, t.worksiteId),
    isoTextPeriodSql(filters, t.occurredAt),
  ) ?? sql`true`
}

/** Un medio equivale a una transacción si coincide el proveedor y, cuando el medio fija canal, la cuenta (`tct:diesel`, `tae:diesel`). */
const providerMediumOn = sql`${fuelSupplyMedia.providerCode} = ${fuelProviderTransactions.provider}
  and (${fuelSupplyMedia.providerChannel} is null or ${fuelProviderTransactions.sourceAccount} like lower(${fuelSupplyMedia.providerChannel}) || ':%')`

export interface FlowTotals {
  inputLiters: number
  directLiters: number
  viaTankLiters: number
  deliveredLiters: number
  differenceLiters: number
  differencePct: number | null
  /** `null` si no hay tolerancia contra la que comparar (sin mandante) o no hay nada que conciliar. */
  overTolerance: boolean | null
}

export interface FlowMonthRow extends FlowTotals { month: string }

export interface ReconciliationFlow {
  totals: FlowTotals
  months: FlowMonthRow[]
  /** Litros contados como directos por ser de tipo «Punto TAE», «Otro» o sin lugar de carga (S-3). */
  assumedDirectLiters: number
}

function totalsFor(input: number, direct: number, viaTank: number, tolerancePct: number | null): FlowTotals {
  const result = reconcile({ inputLiters: input, directLiters: direct, viaTankLiters: viaTank, tolerancePct: tolerancePct ?? Number.POSITIVE_INFINITY })
  return {
    inputLiters: input,
    directLiters: direct,
    viaTankLiters: viaTank,
    deliveredLiters: result.deliveredLiters,
    differenceLiters: result.differenceLiters,
    differencePct: result.differencePct,
    overTolerance: tolerancePct === null || result.withinTolerance === null ? null : !result.withinTolerance,
  }
}

const ASSUMED_DIRECT_TYPES = new Set<string | null>(["tae", "other", null])

interface MonthBucket { input: number; direct: number; viaTank: number }

function bucketFor(byMonth: Map<string, MonthBucket>, month: string): MonthBucket {
  let entry = byMonth.get(month)
  if (!entry) { entry = { input: 0, direct: 0, viaTank: 0 }; byMonth.set(month, entry) }
  return entry
}

/** Suma una entrega de terreno al mes que le toca; devuelve los litros que se contaron como directos por suposición (S-3). */
function addDelivery(entry: MonthBucket, type: string | null, liters: number): number {
  if (deliveryModeFor(type as LoadingPointType | null) === "via_tank") { entry.viaTank += liters; return 0 }
  entry.direct += liters
  return ASSUMED_DIRECT_TYPES.has(type) ? liters : 0
}

function buildFlow(byMonth: Map<string, MonthBucket>, assumedDirectLiters: number, tolerancePct: number | null): ReconciliationFlow {
  const months = [...byMonth.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([month, entry]) => ({ month, ...totalsFor(entry.input, entry.direct, entry.viaTank, tolerancePct) }))
  const sum = (pick: (entry: MonthBucket) => number) => [...byMonth.values()].reduce((total, entry) => total + pick(entry), 0)
  return {
    totals: totalsFor(sum((entry) => entry.input), sum((entry) => entry.direct), sum((entry) => entry.viaTank), tolerancePct),
    months,
    assumedDirectLiters,
  }
}

/** C-02: entrada → directo / vía estanque → diferencia, total y por mes. `tolerancePct` nulo = sin mandante elegido. */
export async function getReconciliationFlow(session: Session | null, filters: ControlFilters, tolerancePct: number | null): Promise<ReconciliationFlow> {
  const t = fuelProviderTransactions
  const [inputRows, providerRows, deliveryRows] = await Promise.all([
    db.select({ month: fuelSupplyInputs.month, liters: sql<number>`coalesce(sum(${fuelSupplyInputs.liters}), 0)::float8` })
      .from(fuelSupplyInputs).where(inputsWhere(session, filters)).groupBy(fuelSupplyInputs.month),
    db.select({ month: isoTextMonthSql(t.occurredAt), liters: sql<number>`coalesce(sum(${t.quantity}), 0)::float8` })
      .from(t).innerJoin(fuelSupplyMedia, providerMediumOn).where(providerWhere(session, filters)).groupBy(isoTextMonthSql(t.occurredAt)),
    db.select({ month: chileMonthSql(fuelTaeSubmissions.loadedAt), type: fuelTaeLoadingPoints.type, liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)::float8` })
      .from(fuelTaeSubmissions).leftJoin(fuelTaeLoadingPoints, eq(fuelTaeLoadingPoints.id, fuelTaeSubmissions.loadingPointId))
      .where(submissionWhere(session, filters)).groupBy(chileMonthSql(fuelTaeSubmissions.loadedAt), fuelTaeLoadingPoints.type),
  ])

  const byMonth = new Map<string, MonthBucket>()
  for (const row of inputRows) bucketFor(byMonth, row.month).input += row.liters
  for (const row of providerRows) bucketFor(byMonth, row.month).input += row.liters
  let assumedDirectLiters = 0
  for (const row of deliveryRows) assumedDirectLiters += addDelivery(bucketFor(byMonth, row.month), row.type, row.liters)
  return buildFlow(byMonth, assumedDirectLiters, tolerancePct)
}

/**
 * La misma cuadratura de `getReconciliationFlow`, para todos los mandantes de una
 * vez: tres consultas agrupadas por mandante en vez de tres por cada uno. Una
 * faena pertenece a un solo mandante (`fuel_mandante_worksites.worksite_id` es la
 * llave primaria), así que nada se cuenta dos veces. `filters.mandanteId` se
 * ignora; cada mandante se mide contra su propia tolerancia. Los mandantes sin
 * movimiento no aparecen en el resultado.
 */
export async function getReconciliationFlowsByMandante(
  session: Session | null,
  filters: ControlFilters,
  tolerances: ReadonlyMap<string, number>,
): Promise<Map<string, ReconciliationFlow>> {
  const t = fuelProviderTransactions
  const mw = fuelMandanteWorksites
  const open: ControlFilters = { ...filters, mandanteId: undefined }
  const [inputRows, providerRows, deliveryRows] = await Promise.all([
    db.select({ mandanteId: mw.mandanteId, month: fuelSupplyInputs.month, liters: sql<number>`coalesce(sum(${fuelSupplyInputs.liters}), 0)::float8` })
      .from(fuelSupplyInputs).innerJoin(mw, eq(mw.worksiteId, fuelSupplyInputs.worksiteId))
      .where(inputsWhere(session, open)).groupBy(mw.mandanteId, fuelSupplyInputs.month),
    db.select({ mandanteId: mw.mandanteId, month: isoTextMonthSql(t.occurredAt), liters: sql<number>`coalesce(sum(${t.quantity}), 0)::float8` })
      .from(t).innerJoin(fuelSupplyMedia, providerMediumOn).innerJoin(mw, eq(mw.worksiteId, t.worksiteId))
      .where(providerWhere(session, open)).groupBy(mw.mandanteId, isoTextMonthSql(t.occurredAt)),
    db.select({ mandanteId: mw.mandanteId, month: chileMonthSql(fuelTaeSubmissions.loadedAt), type: fuelTaeLoadingPoints.type, liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)::float8` })
      .from(fuelTaeSubmissions).innerJoin(mw, eq(mw.worksiteId, fuelTaeSubmissions.worksiteId))
      .leftJoin(fuelTaeLoadingPoints, eq(fuelTaeLoadingPoints.id, fuelTaeSubmissions.loadingPointId))
      .where(submissionWhere(session, open)).groupBy(mw.mandanteId, chileMonthSql(fuelTaeSubmissions.loadedAt), fuelTaeLoadingPoints.type),
  ])

  const perMandante = new Map<string, { byMonth: Map<string, MonthBucket>; assumed: number }>()
  const entryFor = (mandanteId: string) => {
    let entry = perMandante.get(mandanteId)
    if (!entry) { entry = { byMonth: new Map(), assumed: 0 }; perMandante.set(mandanteId, entry) }
    return entry
  }
  for (const row of inputRows) bucketFor(entryFor(row.mandanteId).byMonth, row.month).input += row.liters
  for (const row of providerRows) bucketFor(entryFor(row.mandanteId).byMonth, row.month).input += row.liters
  for (const row of deliveryRows) {
    const entry = entryFor(row.mandanteId)
    entry.assumed += addDelivery(bucketFor(entry.byMonth, row.month), row.type, row.liters)
  }
  return new Map([...perMandante.entries()].map(([mandanteId, entry]) => [mandanteId, buildFlow(entry.byMonth, entry.assumed, tolerances.get(mandanteId) ?? null)]))
}

export interface MediumCrossRow {
  mediumId: string | null
  name: string
  fieldLiters: number
  fieldLoads: number
  /** Litros que informa el proveedor o la tarjeta; `null` si no hay ningún informe del medio (no es un 0). */
  reportedLiters: number | null
  /** Informado − registrado en terreno. */
  differenceLiters: number | null
  differencePct: number | null
}

const NO_MEDIUM_LABEL = "Sin medio asignado"

/** C-03: litros registrados en terreno frente a lo que informa el proveedor, por medio de suministro. */
export async function getMediumCross(session: Session | null, filters: ControlFilters): Promise<MediumCrossRow[]> {
  const t = fuelProviderTransactions
  const [media, fieldRows, inputRows, providerRows] = await Promise.all([
    db.select({ id: fuelSupplyMedia.id, name: fuelSupplyMedia.name }).from(fuelSupplyMedia).orderBy(asc(fuelSupplyMedia.sortOrder), asc(fuelSupplyMedia.name)),
    db.select({ mediumId: fuelTaeSubmissions.supplyMediumId, liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)::float8`, loads: sql<number>`count(*)::int` })
      .from(fuelTaeSubmissions).where(submissionWhere(session, filters)).groupBy(fuelTaeSubmissions.supplyMediumId),
    db.select({ mediumId: fuelSupplyInputs.supplyMediumId, liters: sql<number>`coalesce(sum(${fuelSupplyInputs.liters}), 0)::float8`, records: sql<number>`count(*)::int` })
      .from(fuelSupplyInputs).where(inputsWhere(session, filters)).groupBy(fuelSupplyInputs.supplyMediumId),
    db.select({ mediumId: fuelSupplyMedia.id, liters: sql<number>`coalesce(sum(${t.quantity}), 0)::float8`, records: sql<number>`count(*)::int` })
      .from(t).innerJoin(fuelSupplyMedia, providerMediumOn).where(providerWhere(session, filters)).groupBy(fuelSupplyMedia.id),
  ])

  const field = new Map(fieldRows.map((row) => [row.mediumId, row]))
  const reported = new Map<string, number>()
  for (const row of [...inputRows, ...providerRows]) {
    if (row.records > 0) reported.set(row.mediumId, (reported.get(row.mediumId) ?? 0) + row.liters)
  }

  const build = (mediumId: string | null, name: string): MediumCrossRow | null => {
    const fieldRow = field.get(mediumId)
    const reportedLiters = mediumId ? (reported.get(mediumId) ?? null) : null
    if (!fieldRow && reportedLiters === null) return null
    const fieldLiters = fieldRow?.liters ?? 0
    const differenceLiters = reportedLiters === null ? null : reportedLiters - fieldLiters
    return {
      mediumId,
      name,
      fieldLiters,
      fieldLoads: fieldRow?.loads ?? 0,
      reportedLiters,
      differenceLiters,
      differencePct: differenceLiters === null || !reportedLiters ? null : (differenceLiters / reportedLiters) * 100,
    }
  }
  const rows = media.map((medium) => build(medium.id, medium.name))
  rows.push(build(null, NO_MEDIUM_LABEL))
  return rows.filter((row): row is MediumCrossRow => row !== null)
}

import type { Session } from "next-auth"
import { and, asc, eq, isNotNull, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fuelMandanteWorksites, fuelMandantes, fuelProviderTransactions, fuelSupplyInputs, fuelSupplyMedia, fuelTaeLoadingPoints, fuelTaeSubmissions, worksites } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { reconcile } from "../calc/reconciliation"
import { deliveryModeFor, type LoadingPointType } from "../contracts"
import { mandanteWorksitesSql, type ControlFilters } from "../filters"
import { chileMonthSql, isoTextPeriodSql, submissionWhere, timestampPeriodSql } from "./field-filters"

/**
 * Conciliación por mandante (C-02) y cruce por medio de suministro (C-03).
 * Entrada = entradas importadas + libro de proveedores mapeado a un medio.
 * Entregado = cargas de terreno no anuladas, separadas por el tipo de lugar de
 * carga (supuesto S-3).
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
 * Transacciones del proveedor aceptadas y vigentes. Dos cuidados contra el doble
 * conteo: una fila reemplazada por otra aceptada no cuenta, y el agregado mensual
 * TCT (`period_aggregate`) solo cuenta si no hay transacciones detalladas de la
 * misma cuenta, patente y mes (el informe TCT trae ambos niveles del mismo litro).
 */
function providerWhere(session: Session | null, filters: ControlFilters): SQL {
  const t = fuelProviderTransactions
  return and(
    eq(t.status, "accepted"),
    isNotNull(t.quantity),
    scopeConditions(session, filters, t.worksiteId),
    isoTextPeriodSql(filters, t.occurredAt),
    sql`not exists (select 1 from fuel_provider_transactions n where n.supersedes_id = ${t.id} and n.status = 'accepted')`,
    sql`(${t.granularity} = 'transaction' or not exists (
      select 1 from fuel_provider_transactions d
      where d.provider = ${t.provider} and d.source_account = ${t.sourceAccount}
        and d.source_plate is not distinct from ${t.sourcePlate}
        and d.status = 'accepted' and d.granularity = 'transaction'
        and left(d.occurred_at, 7) = left(${t.occurredAt}, 7)))`,
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

/** C-02: entrada → directo / vía estanque → diferencia, total y por mes. `tolerancePct` nulo = sin mandante elegido. */
export async function getReconciliationFlow(session: Session | null, filters: ControlFilters, tolerancePct: number | null): Promise<ReconciliationFlow> {
  const t = fuelProviderTransactions
  const [inputRows, providerRows, deliveryRows] = await Promise.all([
    db.select({ month: fuelSupplyInputs.month, liters: sql<number>`coalesce(sum(${fuelSupplyInputs.liters}), 0)::float8` })
      .from(fuelSupplyInputs).where(inputsWhere(session, filters)).groupBy(fuelSupplyInputs.month),
    db.select({ month: sql<string>`left(${t.occurredAt}, 7)`, liters: sql<number>`coalesce(sum(${t.quantity}), 0)::float8` })
      .from(t).innerJoin(fuelSupplyMedia, providerMediumOn).where(providerWhere(session, filters)).groupBy(sql`left(${t.occurredAt}, 7)`),
    db.select({ month: chileMonthSql(fuelTaeSubmissions.loadedAt), type: fuelTaeLoadingPoints.type, liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)::float8` })
      .from(fuelTaeSubmissions).leftJoin(fuelTaeLoadingPoints, eq(fuelTaeLoadingPoints.id, fuelTaeSubmissions.loadingPointId))
      .where(submissionWhere(session, filters)).groupBy(chileMonthSql(fuelTaeSubmissions.loadedAt), fuelTaeLoadingPoints.type),
  ])

  const byMonth = new Map<string, { input: number; direct: number; viaTank: number }>()
  const bucket = (month: string) => {
    let entry = byMonth.get(month)
    if (!entry) { entry = { input: 0, direct: 0, viaTank: 0 }; byMonth.set(month, entry) }
    return entry
  }
  for (const row of inputRows) bucket(row.month).input += row.liters
  for (const row of providerRows) bucket(row.month).input += row.liters
  let assumedDirectLiters = 0
  for (const row of deliveryRows) {
    const entry = bucket(row.month)
    if (deliveryModeFor(row.type as LoadingPointType | null) === "via_tank") entry.viaTank += row.liters
    else {
      entry.direct += row.liters
      if (ASSUMED_DIRECT_TYPES.has(row.type)) assumedDirectLiters += row.liters
    }
  }

  const months = [...byMonth.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([month, entry]) => ({ month, ...totalsFor(entry.input, entry.direct, entry.viaTank, tolerancePct) }))
  const sum = (pick: (entry: { input: number; direct: number; viaTank: number }) => number) => [...byMonth.values()].reduce((total, entry) => total + pick(entry), 0)
  return {
    totals: totalsFor(sum((entry) => entry.input), sum((entry) => entry.direct), sum((entry) => entry.viaTank), tolerancePct),
    months,
    assumedDirectLiters,
  }
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

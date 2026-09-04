import { createHash } from "node:crypto"
import { allocateAbsenceDaysByMonth } from "@/lib/prevention/absence-allocation"
import { todayInChile } from "@/lib/utils"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  preventionIncidentAbsencePeriods,
  preventionIncidentPeople,
  preventionIncidents,
  safetyIndicatorDenominators,
  safetyIndicatorHistory,
  safetyIndicatorPeriods,
  safetyIndicatorSnapshots,
  safetyIndicators,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { INCIDENT_EVENT_LABELS, INCIDENT_SEVERITY_LABELS } from "@/lib/prevention/incidents"
import { onSafetyIndicatorPeriodClosed, onSafetyIndicatorPeriodReopened } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import type { WorksiteScope } from "@/lib/auth/scope"
import {
  calculateCanonicalIndicatorPeriod,
  type CanonicalIndicatorCase,
  type CanonicalIndicatorEvent,
  type CanonicalIndicatorResult,
  type ControlledIndicatorDenominator,
  type CanonicalAbsenceAllocation,
} from "@/lib/prevention/safety-indicators-calc"
import {
  approveSafetyIndicatorDenominatorSchema,
  closeSafetyIndicatorPeriodSchema,
  safetyIndicatorDenominatorSchema,
  safetyIndicatorMonthSchema,
  type SafetyIndicatorMonthInput,
} from "@/lib/validation/prevention"

export type { WorksiteScope } from "@/lib/auth/scope"
type IndicatorClient = DB | Tx
const CHILE_YEAR_MONTH_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "numeric",
})

export interface IndicatorAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

interface CanonicalSourceRows {
  events: CanonicalIndicatorEvent[]
  cases: CanonicalIndicatorCase[]
  absenceAllocations: CanonicalAbsenceAllocation[]
  denominators: ControlledIndicatorDenominator[]
  legacyRows: Array<typeof safetyIndicators.$inferSelect>
}

export interface LegacyIndicatorComparison extends Record<string, unknown> {
  legacyId: string | null
  status: "missing_legacy" | "match" | "difference"
  legacy: Record<string, number> | null
  derived: Record<string, number>
  differences: Record<string, number>
}

export interface CanonicalIndicatorGroup {
  worksiteId: string | "total"
  worksiteName: string
  monthly: Array<CanonicalIndicatorResult & { legacyComparison: LegacyIndicatorComparison }>
  semesters: CanonicalIndicatorResult[]
  annual: CanonicalIndicatorResult
}

export interface CanonicalIndicatorYearView {
  year: number
  groups: CanonicalIndicatorGroup[]
  denominators: Array<typeof safetyIndicatorDenominators.$inferSelect>
  closedPeriods: Array<typeof safetyIndicatorPeriods.$inferSelect>
  snapshots: Array<typeof safetyIndicatorSnapshots.$inferSelect>
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (!scopeAllows(scope, worksiteId)) throw new Error("Faena no encontrada o sin acceso.")
}

function requireIndicatorAccess(access: IndicatorAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error("Período de indicadores no encontrado o fuera de alcance.")
  }
}

function scopeFilter<T>(scope: WorksiteScope, column: T) {
  return scope.mode === "all" ? undefined : inArray(column as never, scope.ids)
}

function periodKey(worksiteId: string, year: number, month: number) {
  return `${worksiteId}:${year}:${month}`
}

function safetyIndicatorId(worksiteId: string, year: number, month: number) {
  return `si-${worksiteId}-${year}-${String(month).padStart(2, "0")}`
}

function denominatorId(worksiteId: string, year: number, month: number) {
  return `sid-${worksiteId}-${year}-${String(month).padStart(2, "0")}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function sourceHash(result: CanonicalIndicatorResult) {
  return createHash("sha256").update(stableJson({
    formulaVersion: result.formulaVersion,
    year: result.year,
    startMonth: result.startMonth,
    endMonth: result.endMonth,
    incidentIds: result.incidentIds,
    personCaseKeys: result.personCaseKeys,
    denominatorIds: result.denominatorIds,
    denominatorVersions: result.denominatorVersions,
    confirmed: result.confirmed,
  })).digest("hex")
}

function scopeCondition(scope: WorksiteScope, column: typeof preventionIncidents.worksiteId | typeof safetyIndicatorDenominators.worksiteId | typeof safetyIndicators.worksiteId) {
  if (scope.mode === "all") return undefined
  if (scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

function periodExpressions() {
  return {
    year: sql<number>`extract(year from ${preventionIncidents.occurredAt} at time zone 'America/Santiago')::int`,
    month: sql<number>`extract(month from ${preventionIncidents.occurredAt} at time zone 'America/Santiago')::int`,
  }
}

/**
 * Convierte los períodos de reposo en días por mes. Un reposo abierto se corta
 * en el día de hoy (hora chilena): sigue creciendo en cada corrida, que es el
 * comportamiento correcto para alguien todavía con incapacidad.
 */
function buildAbsenceAllocations(rows: Array<{
  incidentId: string
  personId: string
  worksiteId: string
  startDate: string
  endDate: string | null
}>): CanonicalAbsenceAllocation[] {
  const byPerson = new Map<string, { incidentId: string; personId: string; worksiteId: string; periods: Array<{ startDate: string; endDate: string | null }> }>()
  for (const row of rows) {
    const current = byPerson.get(row.personId)
    if (current) current.periods.push({ startDate: row.startDate, endDate: row.endDate })
    else byPerson.set(row.personId, {
      incidentId: row.incidentId,
      personId: row.personId,
      worksiteId: row.worksiteId,
      periods: [{ startDate: row.startDate, endDate: row.endDate }],
    })
  }
  const today = todayInChile()
  return [...byPerson.values()].flatMap((entry) =>
    allocateAbsenceDaysByMonth(entry.periods, today).map((allocation) => ({
      incidentId: entry.incidentId,
      personId: entry.personId,
      worksiteId: entry.worksiteId,
      ...allocation,
    })),
  )
}

async function loadCanonicalSourceRows(client: IndicatorClient, year: number, scope: WorksiteScope): Promise<CanonicalSourceRows> {
  if (scope.mode !== "all" && scope.ids.length === 0) return { events: [], cases: [], absenceAllocations: [], denominators: [], legacyRows: [] }
  const period = periodExpressions()
  const incidentScope = scopeCondition(scope, preventionIncidents.worksiteId)
  const [eventRows, caseRows, denominators, legacyRows, absenceRows] = await Promise.all([
    client.select({
      incidentId: preventionIncidents.id,
      worksiteId: preventionIncidents.worksiteId,
      year: period.year,
      month: period.month,
      eventType: preventionIncidents.eventType,
    }).from(preventionIncidents).where(and(sql`${period.year} = ${year}`, incidentScope)),
    client.select({
      incidentId: preventionIncidents.id,
      personId: preventionIncidentPeople.id,
      workerId: preventionIncidentPeople.workerId,
      worksiteId: preventionIncidents.worksiteId,
      year: period.year,
      month: period.month,
      eventType: preventionIncidents.eventType,
      absenceAtLeastNormalShift: preventionIncidentPeople.absenceAtLeastNormalShift,
      absenceDays: preventionIncidentPeople.absenceDays,
      chargeDays: preventionIncidentPeople.chargeDays,
      absenceAllocation: preventionIncidentPeople.absenceAllocation,
      inclusionStatus: preventionIncidentPeople.indicatorInclusionStatus,
      sex: preventionIncidentPeople.sex,
    }).from(preventionIncidentPeople)
      .innerJoin(preventionIncidents, eq(preventionIncidents.id, preventionIncidentPeople.incidentId))
      .where(and(sql`${period.year} = ${year}`, incidentScope)),
    client.select().from(safetyIndicatorDenominators).where(and(
      eq(safetyIndicatorDenominators.year, year),
      scopeCondition(scope, safetyIndicatorDenominators.worksiteId),
    )),
    client.select().from(safetyIndicators).where(and(
      eq(safetyIndicators.year, year),
      scopeCondition(scope, safetyIndicators.worksiteId),
    )),
    // NORM-07: los períodos reales de incapacidad. Se traen por incidente del
    // año, pero un reposo puede empezar el año anterior y seguir en éste: el
    // filtro por año se aplica al ACCIDENTE, y el reparto por mes decide después
    // qué días caen dentro del período consultado.
    client.select({
      incidentId: preventionIncidents.id,
      personId: preventionIncidentPeople.id,
      worksiteId: preventionIncidents.worksiteId,
      startDate: preventionIncidentAbsencePeriods.startDate,
      endDate: preventionIncidentAbsencePeriods.endDate,
    }).from(preventionIncidentAbsencePeriods)
      .innerJoin(preventionIncidentPeople, eq(preventionIncidentPeople.id, preventionIncidentAbsencePeriods.personId))
      .innerJoin(preventionIncidents, eq(preventionIncidents.id, preventionIncidentPeople.incidentId))
      .where(and(sql`${period.year} = ${year}`, incidentScope)),
  ])
  return {
    events: eventRows.map((item) => ({ ...item, year: Number(item.year), month: Number(item.month) })),
    cases: caseRows.map((item) => ({
      ...item,
      year: Number(item.year),
      month: Number(item.month),
      absenceAllocation: item.absenceAllocation as CanonicalIndicatorCase["absenceAllocation"],
      inclusionStatus: item.inclusionStatus as CanonicalIndicatorCase["inclusionStatus"],
    })),
    absenceAllocations: buildAbsenceAllocations(absenceRows),
    denominators: denominators.map((item) => ({
      id: item.id,
      worksiteId: item.worksiteId,
      year: item.year,
      month: item.month,
      workerCount: item.workerCount,
      workedHours: item.workedHours,
      status: item.status as ControlledIndicatorDenominator["status"],
      reconciliationStatus: item.reconciliationStatus as ControlledIndicatorDenominator["reconciliationStatus"],
      version: item.version,
    })),
    legacyRows,
  }
}

function calculateGroup(args: {
  year: number
  startMonth: number
  endMonth: number
  worksiteIds: string[]
  source: CanonicalSourceRows
}) {
  const selected = new Set(args.worksiteIds)
  return calculateCanonicalIndicatorPeriod({
    year: args.year,
    startMonth: args.startMonth,
    endMonth: args.endMonth,
    events: args.source.events.filter((item) => selected.has(item.worksiteId)),
    cases: args.source.cases.filter((item) => selected.has(item.worksiteId)),
    absenceAllocations: args.source.absenceAllocations.filter((item) => selected.has(item.worksiteId)),
    denominators: args.source.denominators.filter((item) => selected.has(item.worksiteId)),
    expectedDenominatorSlots: (args.endMonth - args.startMonth + 1) * args.worksiteIds.length,
  })
}

function compareLegacy(
  result: CanonicalIndicatorResult,
  rows: Array<typeof safetyIndicators.$inferSelect>,
): LegacyIndicatorComparison {
  const legacy = rows.length === 0 ? null : {
    trabajadores: rows.reduce((total, item) => total + item.trabajadores, 0),
    horasHombre: rows.reduce((total, item) => total + item.horasHombre, 0),
    accConTiempoPerdido: rows.reduce((total, item) => total + item.accConTiempoPerdido, 0),
    diasPerdidos: rows.reduce((total, item) => total + item.diasPerdidos, 0),
    incidentes: rows.reduce((total, item) => total + item.incidentes, 0),
    danoMaterial: rows.reduce((total, item) => total + item.danoMaterial, 0),
    danoAmbiental: rows.reduce((total, item) => total + item.danoAmbiental, 0),
  }
  const derived = {
    trabajadores: result.workerAverage ?? 0,
    horasHombre: result.workedHours,
    accConTiempoPerdido: result.confirmed.accidents,
    diasPerdidos: result.confirmed.absenceDays + result.confirmed.chargeDays,
    incidentes: result.eventCounts.incidents,
    danoMaterial: result.eventCounts.materialDamage,
    danoAmbiental: result.eventCounts.environmentalDamage,
  }
  const differences = Object.fromEntries(Object.keys(derived).map((key) => [
    key,
    (legacy?.[key as keyof typeof legacy] ?? 0) - derived[key as keyof typeof derived],
  ]))
  const status = !legacy ? "missing_legacy" : Object.values(differences).every((value) => Math.abs(value) < 0.005) ? "match" : "difference"
  return { legacyId: rows[0]?.id ?? null, status, legacy, derived, differences }
}

async function calculateWorksitePeriod(client: IndicatorClient, args: { worksiteId: string; year: number; startMonth: number; endMonth: number }) {
  const source = await loadCanonicalSourceRows(client, args.year, { mode: "some", ids: [args.worksiteId] })
  const result = calculateGroup({ ...args, worksiteIds: [args.worksiteId], source })
  const legacy = source.legacyRows.filter((item) => item.month >= args.startMonth && item.month <= args.endMonth)
  return { result, source, legacyComparison: compareLegacy(result, legacy) }
}

export async function listVisibleWorksites(scope: WorksiteScope) {
  if (scope.mode !== "all" && scope.ids.length === 0) return []
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(scope.mode === "all" ? eq(worksites.isActive, true) : and(eq(worksites.isActive, true), inArray(worksites.id, scope.ids)))
    .orderBy(asc(worksites.name))
}

/** Snapshot manual legado; sólo se conserva para comparación histórica. */
export async function getSafetyIndicators(year: number, scope: WorksiteScope) {
  if (scope.mode !== "all" && scope.ids.length === 0) return []
  return db.select().from(safetyIndicators).where(and(
    eq(safetyIndicators.year, year),
    scope.mode === "all" ? undefined : inArray(safetyIndicators.worksiteId, scope.ids),
  ))
}

export async function getSafetyIndicatorPeriods(year: number, scope: WorksiteScope) {
  if (scope.mode !== "all" && scope.ids.length === 0) return []
  return db.select().from(safetyIndicatorPeriods).where(and(
    eq(safetyIndicatorPeriods.year, year),
    eq(safetyIndicatorPeriods.status, "closed"),
    scope.mode === "all" ? undefined : inArray(safetyIndicatorPeriods.worksiteId, scope.ids),
  ))
}

export async function getCanonicalSafetyIndicatorYear(year: number, scope: WorksiteScope): Promise<CanonicalIndicatorYearView> {
  if (!Number.isInteger(year) || year < 2024 || year > 2100) throw new Error("Año de indicadores inválido.")
  const worksitesVisible = await listVisibleWorksites(scope)
  const ids = worksitesVisible.map((item) => item.id)
  const effectiveScope: WorksiteScope = ids.length > 0 ? { mode: "some", ids } : { mode: "none", ids: [] }
  const source = await loadCanonicalSourceRows(db, year, effectiveScope)

  // Pre-agrupar por worksiteId:month para evitar re-escanear los mismos arrays en cada calculateGroup
  const key = (wsId: string, m: number) => `${wsId}:${m}`
  const eventsByWsMonth = new Map<string, typeof source.events>()
  const casesByWsMonth = new Map<string, typeof source.cases>()
  const denomByWsMonth = new Map<string, typeof source.denominators>()
  for (const wsId of ids) {
    for (let m = 1; m <= 12; m++) {
      const k = key(wsId, m)
      eventsByWsMonth.set(k, [])
      casesByWsMonth.set(k, [])
      denomByWsMonth.set(k, [])
    }
  }
  for (const e of source.events) {
    const k = key(e.worksiteId, e.month)
    eventsByWsMonth.get(k)?.push(e)
  }
  for (const c of source.cases) {
    const k = key(c.worksiteId, c.month)
    casesByWsMonth.get(k)?.push(c)
  }
  for (const d of source.denominators) {
    const k = key(d.worksiteId, d.month)
    denomByWsMonth.get(k)?.push(d)
  }

  function slicesFor(worksiteIds: string[], startMonth: number, endMonth: number) {
    let events: typeof source.events = []
    let cases: typeof source.cases = []
    let denominators: typeof source.denominators = []
    for (const wsId of worksiteIds) {
      for (let m = startMonth; m <= endMonth; m++) {
        events = events.concat(eventsByWsMonth.get(key(wsId, m)) ?? [])
        cases = cases.concat(casesByWsMonth.get(key(wsId, m)) ?? [])
        denominators = denominators.concat(denomByWsMonth.get(key(wsId, m)) ?? [])
      }
    }
    return { events, cases, denominators }
  }

  function groupedCalculate(worksiteIds: string[], startMonth: number, endMonth: number) {
    const { events, cases, denominators } = slicesFor(worksiteIds, startMonth, endMonth)
    return calculateGroup({ year, startMonth, endMonth, worksiteIds, source: { ...source, events, cases, denominators } })
  }

  const groups: CanonicalIndicatorGroup[] = worksitesVisible.map((worksite) => {
    const monthly = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1
      const result = groupedCalculate([worksite.id], month, month)
      return {
        ...result,
        legacyComparison: compareLegacy(result, source.legacyRows.filter((item) => item.worksiteId === worksite.id && item.month === month)),
      }
    })
    return {
      worksiteId: worksite.id,
      worksiteName: worksite.name,
      monthly,
      semesters: [
        groupedCalculate([worksite.id], 1, 6),
        groupedCalculate([worksite.id], 7, 12),
      ],
      annual: groupedCalculate([worksite.id], 1, 12),
    }
  })
  if (ids.length > 0) {
    const monthly = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1
      const result = groupedCalculate(ids, month, month)
      return {
        ...result,
        legacyComparison: compareLegacy(result, source.legacyRows.filter((item) => item.month === month)),
      }
    })
    groups.push({
      worksiteId: "total",
      worksiteName: "Total de faenas visibles",
      monthly,
      semesters: [
        groupedCalculate(ids, 1, 6),
        groupedCalculate(ids, 7, 12),
      ],
      annual: groupedCalculate(ids, 1, 12),
    })
  }
  const [denominators, closedPeriods, snapshots] = await Promise.all([
    db.select().from(safetyIndicatorDenominators).where(and(eq(safetyIndicatorDenominators.year, year), scopeCondition(effectiveScope, safetyIndicatorDenominators.worksiteId))).orderBy(asc(safetyIndicatorDenominators.month)),
    getSafetyIndicatorPeriods(year, effectiveScope),
    db.select().from(safetyIndicatorSnapshots).where(and(eq(safetyIndicatorSnapshots.year, year), scopeFilter(effectiveScope, safetyIndicatorSnapshots.worksiteId))).orderBy(asc(safetyIndicatorSnapshots.createdAt)),
  ])
  return { year, groups, denominators, closedPeriods, snapshots }
}

export async function upsertSafetyIndicatorMonth(
  input: unknown,
  userId: string,
  scope: WorksiteScope,
  canEditClosed: boolean,
): Promise<SafetyIndicatorMonthInput> {
  const data = safetyIndicatorMonthSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)
  const [period] = await db.select().from(safetyIndicatorPeriods).where(and(
    eq(safetyIndicatorPeriods.worksiteId, data.worksiteId),
    eq(safetyIndicatorPeriods.year, data.year),
    eq(safetyIndicatorPeriods.month, data.month),
    eq(safetyIndicatorPeriods.status, "closed"),
  )).limit(1)
  if (period && (!canEditClosed || !data.correctionReason)) {
    throw new Error("El período está cerrado; la corrección exige permiso de cierre y un motivo trazable.")
  }
  const [worksite] = await db.select({ id: worksites.id }).from(worksites).where(eq(worksites.id, data.worksiteId)).limit(1)
  if (!worksite) throw new Error("Faena no encontrada.")
  const now = new Date().toISOString()
  await db.insert(safetyIndicators).values({
    id: safetyIndicatorId(data.worksiteId, data.year, data.month),
    worksiteId: data.worksiteId,
    year: data.year,
    month: data.month,
    trabajadores: data.trabajadores,
    horasHombre: data.horasHombre,
    accConTiempoPerdido: data.accConTiempoPerdido,
    accSinTiempoPerdido: data.accSinTiempoPerdido,
    diasPerdidos: data.diasPerdidos,
    incidentes: data.incidentes,
    danoMaterial: data.danoMaterial,
    danoAmbiental: data.danoAmbiental,
    provenanceStatus: "manual_legacy",
    updatedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [safetyIndicators.worksiteId, safetyIndicators.year, safetyIndicators.month],
    set: {
      trabajadores: data.trabajadores,
      horasHombre: data.horasHombre,
      accConTiempoPerdido: data.accConTiempoPerdido,
      accSinTiempoPerdido: data.accSinTiempoPerdido,
      diasPerdidos: data.diasPerdidos,
      incidentes: data.incidentes,
      danoMaterial: data.danoMaterial,
      danoAmbiental: data.danoAmbiental,
      provenanceStatus: "manual_legacy",
      reconciledSnapshotId: null,
      reconciledByUserId: null,
      reconciledAt: null,
      updatedByUserId: userId,
      updatedAt: now,
    },
  })
  return data
}

async function appendIndicatorHistory(client: IndicatorClient, input: Omit<typeof safetyIndicatorHistory.$inferInsert, "id" | "createdAt">) {
  await client.insert(safetyIndicatorHistory).values({ id: `sih-${nanoid()}`, ...input, createdAt: new Date().toISOString() })
}

/**
 * Lo que hay que revocar en el PDTP cuando un período cerrado se reabre.
 *
 * Se devuelve en vez de dispararse: `reopenClosedPeriod` corre **dentro** de la
 * transacción de quien la llama, y el conector abre la suya. Dispararlo acá
 * sería poner dos transacciones a esperarse por la misma conexión.
 */
export type ReopenedPeriodRevocation = {
  worksiteId: string
  snapshotId: string
  year: number
  month: number
  reason: string
}

async function reopenClosedPeriod(
  client: IndicatorClient,
  args: { worksiteId: string; year: number; month: number; actorUserId: string; reason: string },
): Promise<{ reopened: boolean; revocation: ReopenedPeriodRevocation | null }> {
  const [period] = await client.select().from(safetyIndicatorPeriods).where(and(
    eq(safetyIndicatorPeriods.worksiteId, args.worksiteId),
    eq(safetyIndicatorPeriods.year, args.year),
    eq(safetyIndicatorPeriods.month, args.month),
    eq(safetyIndicatorPeriods.status, "closed"),
  )).limit(1)
  if (!period) return { reopened: false, revocation: null }
  const now = new Date().toISOString()
  if (period.snapshotId) {
    await client.update(safetyIndicatorSnapshots).set({ status: "superseded" }).where(eq(safetyIndicatorSnapshots.id, period.snapshotId))
  }
  await client.update(safetyIndicatorPeriods).set({
    status: "reopened",
    reopenedByUserId: args.actorUserId,
    reopenedAt: now,
    reopenReason: args.reason,
    version: sql`${safetyIndicatorPeriods.version} + 1`,
  }).where(eq(safetyIndicatorPeriods.id, period.id))
  await appendIndicatorHistory(client, {
    worksiteId: args.worksiteId, year: args.year, month: args.month,
    changeType: "superseded", entityType: "period", entityId: period.id,
    reason: args.reason, beforeState: { status: "closed", snapshotId: period.snapshotId }, afterState: { status: "reopened" }, actorUserId: args.actorUserId,
  })
  // Sin snapshot no hubo cierre acreditado y no hay nada que revocar: la N°7 se
  // selló con el id del snapshot, no con el del período ni el de la faena.
  return {
    reopened: true,
    revocation: period.snapshotId
      ? { worksiteId: args.worksiteId, snapshotId: period.snapshotId, year: args.year, month: args.month, reason: args.reason }
      : null,
  }
}

export async function upsertSafetyIndicatorDenominator(input: unknown, access: IndicatorAccess) {
  requireIndicatorAccess(access, "prevention:indicadores:manage")
  const data = safetyIndicatorDenominatorSchema.parse(input)
  requireIndicatorAccess(access, "prevention:indicadores:manage", data.worksiteId)
  let revocation: ReopenedPeriodRevocation | null = null
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(safetyIndicatorDenominators).where(and(
      eq(safetyIndicatorDenominators.worksiteId, data.worksiteId),
      eq(safetyIndicatorDenominators.year, data.year),
      eq(safetyIndicatorDenominators.month, data.month),
    )).limit(1)
    if (data.expectedVersion && existing?.version !== data.expectedVersion) throw new Error("El denominador cambió; recarga antes de guardar.")
    if (existing?.status === "approved") {
      requireIndicatorAccess(access, "prevention:indicadores:close", data.worksiteId)
      if (!data.correctionReason) throw new Error("Corregir un denominador aprobado exige un motivo trazable.")
      // Se prepara acá y se dispara DESPUÉS del commit: el conector abre su
      // propia conexión, y llamarlo dentro dejaría dos transacciones esperándose.
      const reopened = await reopenClosedPeriod(tx, {
        worksiteId: data.worksiteId, year: data.year, month: data.month,
        actorUserId: access.userId, reason: data.correctionReason,
      })
      revocation = reopened.revocation
    }
    const now = new Date().toISOString()
    const status = data.submitForReview ? "pending_review" : "draft"
    const id = existing?.id ?? denominatorId(data.worksiteId, data.year, data.month)
    const [saved] = await tx.insert(safetyIndicatorDenominators).values({
      id,
      worksiteId: data.worksiteId,
      year: data.year,
      month: data.month,
      workerCount: data.workerCount,
      workedHours: data.workedHours,
      sourceType: data.sourceType,
      sourceReference: data.sourceReference,
      evidenceReference: data.evidenceReference,
      evidenceChecksumSha256: data.evidenceChecksumSha256 ?? null,
      status,
      reconciliationStatus: data.reconciliationStatus,
      reconciliationNotes: data.reconciliationNotes ?? null,
      version: 1,
      createdByUserId: access.userId,
      updatedByUserId: access.userId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [safetyIndicatorDenominators.worksiteId, safetyIndicatorDenominators.year, safetyIndicatorDenominators.month],
      set: {
        workerCount: data.workerCount,
        workedHours: data.workedHours,
        sourceType: data.sourceType,
        sourceReference: data.sourceReference,
        evidenceReference: data.evidenceReference,
        evidenceChecksumSha256: data.evidenceChecksumSha256 ?? null,
        status,
        reconciliationStatus: data.reconciliationStatus,
        reconciliationNotes: data.reconciliationNotes ?? null,
        approvedByUserId: null,
        approvedAt: null,
        version: sql`${safetyIndicatorDenominators.version} + 1`,
        updatedByUserId: access.userId,
        updatedAt: now,
      },
    }).returning()
    if (!saved) throw new Error("No se pudo guardar el denominador.")
    await appendIndicatorHistory(tx, {
      worksiteId: data.worksiteId, year: data.year, month: data.month,
      changeType: existing ? (data.submitForReview ? "denominator_submitted" : "denominator_updated") : "denominator_created",
      entityType: "denominator", entityId: saved.id,
      reason: data.correctionReason ?? (data.submitForReview ? "Denominador enviado a revisión" : "Denominador guardado en borrador"),
      beforeState: existing ? { version: existing.version, status: existing.status, workerCount: existing.workerCount, workedHours: existing.workedHours } : null,
      afterState: { version: saved.version, status: saved.status, workerCount: saved.workerCount, workedHours: saved.workedHours },
      actorUserId: access.userId,
    })
    return saved
  })

  // Fuera de la transacción: el conector abre la suya, y corriendo dentro las
  // dos se esperarían por la misma conexión. Reabrir un período cerrado deja sin
  // efecto la acreditación de la N°7 de ese mes.
  if (revocation) await onSafetyIndicatorPeriodReopened(revocation)
  return result
}

export async function approveSafetyIndicatorDenominator(input: unknown, access: IndicatorAccess) {
  requireIndicatorAccess(access, "prevention:indicadores:close")
  const data = approveSafetyIndicatorDenominatorSchema.parse(input)
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(safetyIndicatorDenominators).where(eq(safetyIndicatorDenominators.id, data.denominatorId)).limit(1)
    if (!current) throw new Error("Denominador no encontrado o fuera de alcance.")
    requireIndicatorAccess(access, "prevention:indicadores:close", current.worksiteId)
    if (current.version !== data.expectedVersion) throw new Error("El denominador cambió; recarga antes de decidir.")
    if (current.status !== "pending_review") throw new Error("Sólo se puede decidir un denominador pendiente de revisión.")
    if (current.createdByUserId === access.userId || current.updatedByUserId === access.userId) throw new Error("Quien preparó el denominador no puede aprobarlo.")
    if (data.decision === "approved" && (!current.evidenceReference || current.reconciliationStatus === "pending")) {
      throw new Error("La aprobación exige evidencia y conciliación resuelta.")
    }
    const now = new Date().toISOString()
    const [updated] = await tx.update(safetyIndicatorDenominators).set({
      status: data.decision,
      approvedByUserId: data.decision === "approved" ? access.userId : null,
      approvedAt: data.decision === "approved" ? now : null,
      version: sql`${safetyIndicatorDenominators.version} + 1`,
      updatedByUserId: access.userId,
      updatedAt: now,
    }).where(and(eq(safetyIndicatorDenominators.id, current.id), eq(safetyIndicatorDenominators.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("El denominador cambió; recarga antes de decidir.")
    await appendIndicatorHistory(tx, {
      worksiteId: current.worksiteId, year: current.year, month: current.month,
      changeType: data.decision === "approved" ? "denominator_approved" : "denominator_rejected",
      entityType: "denominator", entityId: current.id, reason: data.reason,
      beforeState: { status: current.status, version: current.version },
      afterState: { status: updated.status, version: updated.version }, actorUserId: access.userId,
    })
    return updated
  })
}

async function createApprovedSnapshot(client: IndicatorClient, args: {
  worksiteId: string
  year: number
  month: number
  actorUserId: string
  reason: string
}) {
  const { result, legacyComparison } = await calculateWorksitePeriod(client, {
    worksiteId: args.worksiteId, year: args.year, startMonth: args.month, endMonth: args.month,
  })
  if (result.status !== "reconciled" || result.pendingCaseCount > 0) {
    const detail = [...result.errors, ...result.reconciliationIssues].join(" ")
    throw new Error(`El período no puede cerrarse: ${detail || "existen fuentes pendientes"}.`)
  }
  const hash = sourceHash(result)
  const [existing] = await client.select().from(safetyIndicatorSnapshots).where(and(
    eq(safetyIndicatorSnapshots.worksiteId, args.worksiteId),
    eq(safetyIndicatorSnapshots.periodType, "monthly"),
    eq(safetyIndicatorSnapshots.year, args.year),
    eq(safetyIndicatorSnapshots.startMonth, args.month),
    eq(safetyIndicatorSnapshots.endMonth, args.month),
    eq(safetyIndicatorSnapshots.sourceHashSha256, hash),
  )).limit(1)
  if (existing?.status === "approved") return { snapshot: existing, result, legacyComparison }
  const now = new Date().toISOString()
  const previous = await client.select().from(safetyIndicatorSnapshots).where(and(
    eq(safetyIndicatorSnapshots.worksiteId, args.worksiteId),
    eq(safetyIndicatorSnapshots.periodType, "monthly"),
    eq(safetyIndicatorSnapshots.year, args.year),
    eq(safetyIndicatorSnapshots.startMonth, args.month),
    eq(safetyIndicatorSnapshots.status, "approved"),
  ))
  const snapshotId = existing?.id ?? `sis-${nanoid()}`
  if (previous.length > 0) {
    await client.update(safetyIndicatorSnapshots)
      .set({ status: "superseded", supersededById: snapshotId })
      .where(inArray(safetyIndicatorSnapshots.id, previous.map((item) => item.id)))
  }
  const resultSnapshot = {
    status: result.status,
    accidents: result.confirmed.accidents,
    injuredPeople: result.confirmed.injuredPeople,
    absenceDays: result.confirmed.absenceDays,
    chargeDays: result.confirmed.chargeDays,
    workerAverage: result.workerAverage,
    workedHours: result.workedHours,
    accidentabilityRate: result.confirmed.accidentabilityRate,
    frequencyRate: result.confirmed.frequencyRate,
    severityRate: result.confirmed.severityRate,
  }
  const inputSnapshot = {
    incidentIds: result.incidentIds,
    personCaseKeys: result.personCaseKeys,
    denominatorIds: result.denominatorIds,
    denominatorVersions: result.denominatorVersions,
  }
  const [snapshot] = existing
    ? await client.update(safetyIndicatorSnapshots).set({
      status: "approved", resultSnapshot, inputSnapshot, hasPendingCases: false,
      reconciliationStatus: "matched", legacyComparison, supersededById: null,
      version: sql`${safetyIndicatorSnapshots.version} + 1`, approvedByUserId: args.actorUserId,
      approvalReason: args.reason, approvedAt: now,
    }).where(eq(safetyIndicatorSnapshots.id, existing.id)).returning()
    : await client.insert(safetyIndicatorSnapshots).values({
      id: snapshotId, worksiteId: args.worksiteId, periodType: "monthly", year: args.year,
      startMonth: args.month, endMonth: args.month, formulaVersion: result.formulaVersion,
      sourceHashSha256: hash, inputSnapshot, resultSnapshot, status: "approved",
      hasPendingCases: false, reconciliationStatus: "matched", legacyComparison,
      version: 1, createdByUserId: args.actorUserId, approvedByUserId: args.actorUserId,
      approvalReason: args.reason, createdAt: now, approvedAt: now,
    }).returning()
  if (!snapshot) throw new Error("No se pudo guardar el snapshot del período.")
  await client.update(safetyIndicators).set({
    provenanceStatus: legacyComparison.status === "match" ? "reconciled" : "difference",
    reconciledSnapshotId: snapshot.id,
    reconciledByUserId: args.actorUserId,
    reconciledAt: now,
  }).where(and(
    eq(safetyIndicators.worksiteId, args.worksiteId),
    eq(safetyIndicators.year, args.year),
    eq(safetyIndicators.month, args.month),
  ))
  return { snapshot, result, legacyComparison }
}

export async function closeSafetyIndicatorPeriod(
  input: unknown,
  userId: string,
  scope: WorksiteScope,
) {
  const data = closeSafetyIndicatorPeriodSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)
  const outcome = await db.transaction(async (tx) => {
    const [worksite] = await tx.select({ id: worksites.id }).from(worksites).where(eq(worksites.id, data.worksiteId)).limit(1)
    if (!worksite) throw new Error("Faena no encontrada o sin acceso.")
    const { snapshot, result, legacyComparison } = await createApprovedSnapshot(tx, {
      worksiteId: data.worksiteId, year: data.year, month: data.month, actorUserId: userId, reason: data.reason,
    })
    const now = new Date().toISOString()
    const id = `sip-${data.worksiteId}-${data.year}-${String(data.month).padStart(2, "0")}`
    const [period] = await tx.insert(safetyIndicatorPeriods).values({
      id, worksiteId: data.worksiteId, year: data.year, month: data.month,
      closedByUserId: userId, closedAt: now, status: "closed", snapshotId: snapshot.id,
      closeReason: data.reason, version: 1,
    }).onConflictDoUpdate({
      target: [safetyIndicatorPeriods.worksiteId, safetyIndicatorPeriods.year, safetyIndicatorPeriods.month],
      set: {
        closedByUserId: userId, closedAt: now, status: "closed", snapshotId: snapshot.id,
        closeReason: data.reason, reopenedByUserId: null, reopenedAt: null, reopenReason: null,
        version: sql`${safetyIndicatorPeriods.version} + 1`,
      },
    }).returning()
    if (!period) throw new Error("No se pudo cerrar el período.")
    await appendIndicatorHistory(tx, {
      worksiteId: data.worksiteId, year: data.year, month: data.month,
      changeType: "closed", entityType: "period", entityId: period.id, reason: data.reason,
      beforeState: null, afterState: { snapshotId: snapshot.id, sourceHashSha256: snapshot.sourceHashSha256, result: result.confirmed, legacyStatus: legacyComparison.status },
      actorUserId: userId,
    })
    return { period, snapshot, result, legacyComparison }
  })

  // Auto-acreditación PDTP (N°7), después del commit: el motor escribe con su
  // propia conexión, y llamarlo dentro de la transacción dejaría una
  // ejecución huérfana si ésta revierte.
  await onSafetyIndicatorPeriodClosed({
    worksiteId: data.worksiteId,
    snapshotId: outcome.snapshot.id,
    year: data.year,
    month: data.month,
    closedAt: outcome.period.closedAt!,
  })

  return outcome
}

export async function invalidateClosedIndicatorPeriodWithClient(client: IndicatorClient, args: {
  worksiteId: string
  occurredAt: string
  actorUserId: string
  reason: string
  permissions: readonly string[]
}) {
  const date = new Date(args.occurredAt)
  const parts = CHILE_YEAR_MONTH_FORMATTER.formatToParts(date)
  const year = Number(parts.find((item) => item.type === "year")?.value)
  const month = Number(parts.find((item) => item.type === "month")?.value)
  if (!year || !month) throw new Error("Fecha de incidente inválida para recalcular indicadores.")
  const [closed] = await client.select({ id: safetyIndicatorPeriods.id }).from(safetyIndicatorPeriods).where(and(
    eq(safetyIndicatorPeriods.worksiteId, args.worksiteId),
    eq(safetyIndicatorPeriods.year, year),
    eq(safetyIndicatorPeriods.month, month),
    eq(safetyIndicatorPeriods.status, "closed"),
  )).limit(1)
  if (!closed) return { reopened: false, revocation: null }
  if (!args.permissions.includes("prevention:indicadores:close")) throw new Error("Corregir una fuente de un período cerrado exige permiso de cierre de indicadores.")
  return reopenClosedPeriod(client, {
    worksiteId: args.worksiteId, year, month, actorUserId: args.actorUserId, reason: args.reason,
  })
}

/**
 * Envoltorio transaccional de `invalidateClosedIndicatorPeriodWithClient`, con
 * el disparo de la revocación después del commit.
 *
 * No tiene llamadores hoy —quien invalida un período lo hace desde dentro de su
 * propia transacción, en `prevention-incidents.ts`— y se conserva por eso
 * mismo: es la forma correcta de usarla desde fuera, y tenerla escrita evita
 * que el próximo llamador arme la suya olvidando el post-commit.
 */
export async function invalidateClosedIndicatorPeriod(args: {
  worksiteId: string
  occurredAt: string
  actorUserId: string
  reason: string
  permissions: readonly string[]
}) {
  const result = await db.transaction((tx) => invalidateClosedIndicatorPeriodWithClient(tx, args))
  if (result.revocation) await onSafetyIndicatorPeriodReopened(result.revocation)
  return result
}

export function safetyIndicatorPeriodIdentity(worksiteId: string, year: number, month: number) {
  return periodKey(worksiteId, year, month)
}

export interface MaterialEnvironmentalEventData {
  worksiteId: string
  worksiteName: string
  monthly: Array<{
    month: number
    dangerousIncidents: number
    materialDamage: number
    environmentalSpills: number
  }>
  annual: {
    dangerousIncidents: number
    materialDamage: number
    environmentalSpills: number
  }
}

/**
 * Obtiene el conteo canónico de eventos material y ambiental desde el registro
 * de incidentes, agrupado por faena y mes. Solo considera eventos tipo:
 * - dangerous_incident (incidente peligroso)
 * - material_damage (daño material)
 * - environmental_spill (daño ambiental/derrame)
 */
export async function getMaterialEnvironmentalEvents(
  year: number,
  scope: WorksiteScope,
): Promise<{ worksites: Array<{ id: string; name: string }>; eventData: MaterialEnvironmentalEventData[] }> {
  if (!Number.isInteger(year) || year < 2024 || year > 2100) throw new Error("Año inválido.")

  const worksitesVisible = await listVisibleWorksites(scope)
  const ids = worksitesVisible.map((item) => item.id)
  if (ids.length === 0) return { worksites: [], eventData: [] }

  const effectiveScope: WorksiteScope = ids.length > 0 ? { mode: "some", ids } : { mode: "none", ids: [] }

  const period = periodExpressions()
  const incidentScope = scopeCondition(effectiveScope, preventionIncidents.worksiteId)

  const eventTypes = ["dangerous_incident", "material_damage", "environmental_spill"]

  const rows = await db.select({
    incidentId: preventionIncidents.id,
    worksiteId: preventionIncidents.worksiteId,
    year: period.year,
    month: period.month,
    eventType: preventionIncidents.eventType,
  }).from(preventionIncidents).where(and(
    sql`${period.year} = ${year}`,
    inArray(preventionIncidents.eventType, eventTypes),
    incidentScope,
  ))

  type Accumulator = { dangerousIncidents: number; materialDamage: number; environmentalSpills: number }

  function emptyAcc(): Accumulator {
    return { dangerousIncidents: 0, materialDamage: 0, environmentalSpills: 0 }
  }

  // Agrupar por worksiteId + month
  const byWsMonth = new Map<string, Accumulator>()
  const byWsYear = new Map<string, Accumulator>()

  for (const row of rows) {
    const wsKey = `${row.worksiteId}:${row.month}`
    const wsAnnualKey = row.worksiteId

    if (!byWsMonth.has(wsKey)) byWsMonth.set(wsKey, emptyAcc())
    if (!byWsYear.has(wsAnnualKey)) byWsYear.set(wsAnnualKey, emptyAcc())

    const monthAcc = byWsMonth.get(wsKey)!
    const yearAcc = byWsYear.get(wsAnnualKey)!

    if (row.eventType === "dangerous_incident") {
      monthAcc.dangerousIncidents++
      yearAcc.dangerousIncidents++
    } else if (row.eventType === "material_damage") {
      monthAcc.materialDamage++
      yearAcc.materialDamage++
    } else if (row.eventType === "environmental_spill") {
      monthAcc.environmentalSpills++
      yearAcc.environmentalSpills++
    }
  }

  // Armar data por faena
  const eventData: MaterialEnvironmentalEventData[] = worksitesVisible.map((worksite) => {
    const monthly = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1
      const acc = byWsMonth.get(`${worksite.id}:${month}`) ?? emptyAcc()
      return { month, ...acc }
    })
    const annual = byWsYear.get(worksite.id) ?? emptyAcc()
    return { worksiteId: worksite.id, worksiteName: worksite.name, monthly, annual }
  })

  // Armar total
  if (ids.length > 0) {
    const totalMonthly = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1
      let dangerousIncidents = 0
      let materialDamage = 0
      let environmentalSpills = 0
      for (const wsId of ids) {
        const acc = byWsMonth.get(`${wsId}:${month}`) ?? emptyAcc()
        dangerousIncidents += acc.dangerousIncidents
        materialDamage += acc.materialDamage
        environmentalSpills += acc.environmentalSpills
      }
      return { month, dangerousIncidents, materialDamage, environmentalSpills }
    })

    let totalDangerous = 0
    let totalMaterial = 0
    let totalEnvironmental = 0
    for (const [, acc] of byWsYear) {
      totalDangerous += acc.dangerousIncidents
      totalMaterial += acc.materialDamage
      totalEnvironmental += acc.environmentalSpills
    }

    eventData.push({
      worksiteId: "total",
      worksiteName: "Total de faenas visibles",
      monthly: totalMonthly,
      annual: { dangerousIncidents: totalDangerous, materialDamage: totalMaterial, environmentalSpills: totalEnvironmental },
    })
  }

  return {
    worksites: worksitesVisible,
    eventData,
  }
}

export interface IncidentAnalyticsData {
  commonAccidents: Array<{ type: string; label: string; count: number }>
  worksiteIncidents: Array<{ id: string; name: string; minor: number; medical: number; lostTime: number; serious: number; total: number }>
  potentialSeverity: Array<{ severity: string; label: string; count: number }>
}

export async function getIncidentAnalyticsData(
  year: number,
  scope: WorksiteScope,
): Promise<IncidentAnalyticsData> {
  const worksitesVisible = await listVisibleWorksites(scope)
  const ids = worksitesVisible.map((item) => item.id)
  if (ids.length === 0) {
    return { commonAccidents: [], worksiteIncidents: [], potentialSeverity: [] }
  }

  const effectiveScope: WorksiteScope = { mode: "some", ids }
  const period = periodExpressions()
  const incidentScope = scopeCondition(effectiveScope, preventionIncidents.worksiteId)

  const rows = await db.select({
    id: preventionIncidents.id,
    worksiteId: preventionIncidents.worksiteId,
    eventType: preventionIncidents.eventType,
    actualSeverity: preventionIncidents.actualSeverity,
    potentialSeverity: preventionIncidents.potentialSeverity,
  }).from(preventionIncidents).where(and(
    sql`${period.year} = ${year}`,
    incidentScope,
  ))

  const typeCounts = new Map<string, number>()
  const potentialCounts = new Map<string, number>()
  const worksiteMap = new Map<string, { minor: number; medical: number; lostTime: number; serious: number; total: number }>()

  for (const row of rows) {
    typeCounts.set(row.eventType, (typeCounts.get(row.eventType) || 0) + 1)
    potentialCounts.set(row.potentialSeverity, (potentialCounts.get(row.potentialSeverity) || 0) + 1)

    if (!worksiteMap.has(row.worksiteId)) {
      worksiteMap.set(row.worksiteId, { minor: 0, medical: 0, lostTime: 0, serious: 0, total: 0 })
    }
    const wsAcc = worksiteMap.get(row.worksiteId)!
    wsAcc.total++
    if (row.actualSeverity === "minor") wsAcc.minor++
    else if (row.actualSeverity === "medical_treatment") wsAcc.medical++
    else if (row.actualSeverity === "lost_time") wsAcc.lostTime++
    else if (row.actualSeverity === "serious" || row.actualSeverity === "fatal") wsAcc.serious++
  }

  // Etiquetas canónicas de `lib/prevention/incidents`: las mismas que usa el
  // listado de incidentes. Antes estaban duplicadas acá con otra redacción
  // ("Incidente peligroso" vs "Incidente o suceso peligroso", "Bajo" vs "Baja"),
  // así que el mismo tipo de evento se leía distinto según la pantalla (regla A6).
  const commonAccidents = Array.from(typeCounts.entries()).map(([type, count]) => ({
    type,
    label: INCIDENT_EVENT_LABELS[type] || type,
    count,
  })).sort((a, b) => b.count - a.count)

  const potentialSeverity = Array.from(potentialCounts.entries()).map(([severity, count]) => ({
    severity,
    label: INCIDENT_SEVERITY_LABELS[severity] || severity,
    count,
  })).sort((a, b) => b.count - a.count)

  const worksiteIncidents = worksitesVisible.map((ws) => {
    const acc = worksiteMap.get(ws.id) || { minor: 0, medical: 0, lostTime: 0, serious: 0, total: 0 }
    return { id: ws.id, name: ws.name, ...acc }
  }).sort((a, b) => b.total - a.total)

  return { commonAccidents, worksiteIncidents, potentialSeverity }
}

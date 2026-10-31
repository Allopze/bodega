import "server-only"
import type { Session } from "next-auth"
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, lte, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  fuelAnomalyCases,
  fuelAnomalyExecutions,
  fuelConsumptionRecords,
  fuelEquipmentLoads,
  fuelEquipmentTypes,
  fuelImportBatches,
  fuelLoads,
  fuelOperationRecords,
  fuelProviderMappings,
  fuelReviewMarks,
  fuelTaeSubmissions,
  fuelVehicles,
  users,
  worksites,
} from "@/db/schema"
import { can } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSqlFor } from "@/lib/auth/scope"
import { getAnomalyCases, type AnomalyCaseRow } from "@/lib/combustibles/anomaly-cases"
import { ANOMALY_STATUS_LABELS } from "@/lib/combustibles/anomaly-labels"
import { parseInstantMs } from "@/lib/combustibles/control/calc/performance-series"
import { LOAD_SOURCE_LABELS, PERFORMANCE_UNIT_LABELS, PERFORMANCE_UNIT_TITLES, type LoadSource, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { statisticallyValidLoadSql } from "@/lib/combustibles/control/filters"
import { loadPerformanceControlContext, thresholdForEquipmentType } from "@/lib/combustibles/control/settings"
import { toChileInstantRange } from "@/lib/combustibles/period/adapters"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { fuelBatchHref, fuelEquipmentHref, fuelLoadHref, fuelLoadHrefFromEquipmentLoad, type FuelLoadOrigin } from "@/lib/combustibles/routes"
import { logger } from "@/lib/logger"
import { getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { formatQty } from "@/lib/utils"
import { decisionKindsFor, type FuelInboxItem, type FuelInboxItemExtras, type FuelInboxQueryFilters } from "./detail-types"
import { flagDatum, flagReasonsLabel, flagReasonTitle, knownFlagReasons, primaryFlagReason } from "./reasons"
import {
  FUEL_INBOX_KINDS,
  compareInboxRows,
  inboxDueDate,
  inboxRowKey,
  parseInboxRowKey,
  type FuelInboxEvidence,
  type FuelInboxItemDetail,
  type FuelInboxKind,
  type FuelInboxPage,
  type FuelInboxRow,
  type FuelInboxSummary,
} from "./types"

/**
 * Lectura de la bandeja «Por revisar»: une cuatro tipos de pendiente en una lista.
 *
 *  - `carga`: cargas en `review_status = 'flagged'` (lo que hacía la cola de revisión);
 *  - `caso`: casos de anomalía vigentes (`open`, `in_review`, `reopened`);
 *  - `patente`: patentes de un reporte de tarjeta (Copec, Aramco) que no están en la flota;
 *  - `pedido`: pedidos de revisión de una persona (`fuel_review_marks.status = 'open'`).
 *
 * Cada fila lleva el mes del dato (`dataMonth`) y de ahí su fecha límite (fin de ese
 * mes). «Pendientes» es todo lo cuyo mes del dato es ≤ el fin del período, no sólo lo
 * que cae dentro: lo vencido sigue apareciendo hasta que alguien lo decide.
 * «Decididas» es lo decidido dentro del período.
 *
 * El alcance por faena se aplica en cada consulta (`worksiteScopeSqlFor`), nunca
 * después: un id fuera de las faenas de la sesión no devuelve nada.
 */

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
/** Estados de un caso que todavía piden una decisión. */
const OPEN_CASE_STATUSES = ["open", "in_review", "reopened"] as const
/** Estados de una carga cuyo rendimiento mueve el ancla de lectura del equipo. */
const ANCHOR_STATUSES = ["first_load", "computed", "meter_reset", "zero_delta"]
const EQUIPMENT_UNKNOWN = "Equipo sin ficha"
/** Motivo con el que `linkConsumptionPlateAction` deja sus vínculos manuales; es lo que identifica «Vinculada». */
const MANUAL_LINK_REASON = "Vínculo manual%"
const OPEN_ENDED_RANGE = { start: "1970-01-01T00:00:00.000Z", endExclusive: "9999-12-31T00:00:00.000Z" }

type Scope = string[] | "all"
type View = "pendientes" | "decididas"

interface Ctx {
  session: Session
  scope: Scope
  worksiteId?: string
  /** Último mes ("YYYY-MM") que cubre el período: tope de «Pendientes». */
  lastMonth: string
  /** Instantes UTC del período en hora de Chile (fin exclusivo): ventana de «Decididas». */
  range: { start: string; endExclusive: string }
  filters: FuelInboxQueryFilters
}

function buildCtx(session: Session, period: ResolvedFuelPeriod, filters: FuelInboxQueryFilters): Ctx {
  const range = toChileInstantRange(period)
  return {
    session,
    scope: serviceWorksiteScope(session),
    worksiteId: filters.worksiteId?.trim() || undefined,
    lastMonth: period.to.slice(0, 7),
    range,
    filters,
  }
}

const iso = (value: string): string => {
  const ms = parseInstantMs(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value
}

function equipmentLabelOf(code: string | null | undefined, plate: string | null | undefined, raw?: string | null): string {
  const parts = [code, plate].filter((part): part is string => Boolean(part))
  if (parts.length > 0) return parts.join(" · ")
  return raw?.trim() || EQUIPMENT_UNKNOWN
}

const fmt = (value: number, digits = 1) => formatQty(value, undefined, { maximumFractionDigits: digits })

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
const monthName = (month: string): string => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month

/** Mes "YYYY-MM" (hora de Chile) del registro al que apunta una referencia polimórfica; si no se resuelve, el de `fallback`. */
function refMonthSql(typeColumn: AnyColumn, idColumn: AnyColumn, fallback: AnyColumn): SQL<string> {
  return sql<string>`coalesce(
    case ${typeColumn}
      when 'fuel_tae_submission' then (select to_char(s.loaded_at at time zone 'America/Santiago', 'YYYY-MM') from fuel_tae_submissions s where s.id = ${idColumn})
      when 'fuel_operation_record' then (select substr(o.fecha, 1, 7) from fuel_operation_records o where o.id = ${idColumn})
      when 'fuel_load' then (select l.month from fuel_loads l where l.id = ${idColumn})
    end,
    to_char(${fallback} at time zone 'America/Santiago', 'YYYY-MM')
  )`
}

const ENTITY_ORIGIN: Record<string, FuelLoadOrigin> = {
  fuel_tae_submission: "terreno",
  fuel_operation_record: "planilla",
  fuel_load: "factura",
}

function hrefForEntity(entityType: string | null, entityId: string | null): string | null {
  const origen = entityType ? ENTITY_ORIGIN[entityType] : undefined
  return origen && entityId ? fuelLoadHref({ origen, id: entityId }) : null
}

/* ────────────────────────────── Cargas por decidir ───────────────────────────── */

const orig = alias(fuelEquipmentLoads, "orig_load")

/** Última lectura válida del equipo antes de esta carga: el dato que explica «lectura menor a la anterior». */
const previousReadingSql = sql<number | null>`(
  select p.meter_reading from fuel_equipment_loads p
  where p.vehicle_id = ${fuelEquipmentLoads.vehicleId}
    and p.occurred_at < ${fuelEquipmentLoads.occurredAt}
    and p.meter_reading is not null
    and p.voided_at is null
    and p.performance_status in ('first_load', 'computed', 'meter_reset', 'zero_delta')
  order by p.occurred_at desc, p.id desc
  limit 1
)`.mapWith((value) => (value === null || value === undefined ? null : Number(value)))

const cargaSelect = {
  id: fuelEquipmentLoads.id,
  worksiteId: fuelEquipmentLoads.worksiteId,
  worksiteName: worksites.name,
  vehicleId: fuelEquipmentLoads.vehicleId,
  vehicleCode: fuelVehicles.code,
  vehiclePlate: fuelVehicles.plate,
  capacity: fuelVehicles.tankCapacityLiters,
  typeSlug: fuelEquipmentTypes.slug,
  source: fuelEquipmentLoads.source,
  taeSubmissionId: fuelEquipmentLoads.taeSubmissionId,
  operationRecordId: fuelEquipmentLoads.operationRecordId,
  occurredAt: fuelEquipmentLoads.occurredAt,
  month: fuelEquipmentLoads.month,
  createdAt: fuelEquipmentLoads.createdAt,
  liters: fuelEquipmentLoads.liters,
  meterType: fuelEquipmentLoads.meterType,
  meterReading: fuelEquipmentLoads.meterReading,
  performanceValue: fuelEquipmentLoads.performanceValue,
  performanceUnit: fuelEquipmentLoads.performanceUnit,
  reviewStatus: fuelEquipmentLoads.reviewStatus,
  reviewNote: fuelEquipmentLoads.reviewNote,
  reviewedAt: fuelEquipmentLoads.reviewedAt,
  reviewerName: users.name,
  flagReasons: fuelEquipmentLoads.flagReasons,
  duplicateOfId: fuelEquipmentLoads.duplicateOfId,
  voidedAt: fuelEquipmentLoads.voidedAt,
  origLiters: orig.liters,
  origOccurredAt: orig.occurredAt,
  origSource: orig.source,
  origTaeSubmissionId: orig.taeSubmissionId,
  origOperationRecordId: orig.operationRecordId,
  opPlate: fuelOperationRecords.plate,
  opCode: fuelOperationRecords.code,
  taePlate: fuelTaeSubmissions.plateSnapshot,
  taeCode: fuelTaeSubmissions.equipmentCodeSnapshot,
  taeSubmittedAt: fuelTaeSubmissions.submittedAt,
  taeBackdateReason: fuelTaeSubmissions.backdateReason,
  previousReading: previousReadingSql,
}

async function fetchCargaRaw(where: SQL | undefined, order: SQL[], limit: number, offset: number) {
  return db.select(cargaSelect)
    .from(fuelEquipmentLoads)
    .innerJoin(worksites, eq(worksites.id, fuelEquipmentLoads.worksiteId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelEquipmentLoads.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .leftJoin(users, eq(users.id, fuelEquipmentLoads.reviewedBy))
    .leftJoin(orig, eq(orig.id, fuelEquipmentLoads.duplicateOfId))
    .leftJoin(fuelOperationRecords, eq(fuelOperationRecords.id, fuelEquipmentLoads.operationRecordId))
    .leftJoin(fuelTaeSubmissions, eq(fuelTaeSubmissions.id, fuelEquipmentLoads.taeSubmissionId))
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .offset(offset)
}

type CargaRaw = Awaited<ReturnType<typeof fetchCargaRaw>>[number]

function cargaDecisionStatuses(decision: string | undefined): string[] {
  if (decision === "cuenta") return ["approved"]
  if (decision === "no-cuenta") return ["rejected"]
  return ["approved", "rejected"]
}

function cargaWhere(ctx: Ctx, view: View): SQL | undefined {
  return and(
    worksiteScopeSqlFor(ctx.scope, fuelEquipmentLoads.worksiteId, ctx.worksiteId),
    view === "pendientes"
      ? and(eq(fuelEquipmentLoads.reviewStatus, "flagged"), isNull(fuelEquipmentLoads.voidedAt), lte(fuelEquipmentLoads.month, ctx.lastMonth))
      : and(
          inArray(fuelEquipmentLoads.reviewStatus, cargaDecisionStatuses(ctx.filters.decision)),
          gte(fuelEquipmentLoads.reviewedAt, ctx.range.start),
          lt(fuelEquipmentLoads.reviewedAt, ctx.range.endExclusive),
        ),
  )
}

interface RangeInfo { low: number; high: number; samples: number }

/** Media ± k desviaciones de las cargas válidas de cada equipo: lo «normal» contra lo que se juzga una atípica. */
async function vehicleRanges(rows: CargaRaw[]): Promise<Map<string, RangeInfo>> {
  const wanted = rows.filter((row) => row.vehicleId && knownFlagReasons(row.flagReasons).includes("outlier"))
  const vehicleIds = [...new Set(wanted.map((row) => row.vehicleId!))]
  const out = new Map<string, RangeInfo>()
  if (vehicleIds.length === 0) return out
  const [stats, context] = await Promise.all([
    db.select({
      vehicleId: fuelEquipmentLoads.vehicleId,
      average: sql<number | null>`avg(${fuelEquipmentLoads.performanceValue})::float8`,
      deviation: sql<number | null>`stddev_samp(${fuelEquipmentLoads.performanceValue})::float8`,
      samples: sql<number>`count(*)::int`,
    }).from(fuelEquipmentLoads).where(and(statisticallyValidLoadSql, inArray(fuelEquipmentLoads.vehicleId, vehicleIds))).groupBy(fuelEquipmentLoads.vehicleId),
    loadPerformanceControlContext(db),
  ])
  const slugByVehicle = new Map(wanted.map((row) => [row.vehicleId!, row.typeSlug]))
  for (const stat of stats) {
    if (!stat.vehicleId || stat.average === null || stat.deviation === null) continue
    const k = thresholdForEquipmentType(context.settings, context.ruleConfig, slugByVehicle.get(stat.vehicleId))
    out.set(stat.vehicleId, { low: stat.average - k * stat.deviation, high: stat.average + k * stat.deviation, samples: stat.samples })
  }
  return out
}

function cargaToRow(raw: CargaRaw, ranges: Map<string, RangeInfo>, session: Session): FuelInboxRow {
  const codes = knownFlagReasons(raw.flagReasons)
  const decidedStatus = raw.reviewStatus === "approved" || raw.reviewStatus === "rejected"
  const unit = raw.performanceUnit === "km_per_liter" || raw.performanceUnit === "liters_per_hour" ? (raw.performanceUnit as PerformanceUnit) : null
  const origin = LOAD_SOURCE_LABELS[raw.source as LoadSource] ?? raw.source
  const range = raw.vehicleId ? ranges.get(raw.vehicleId) : undefined
  const rawEquipment = raw.opCode ?? raw.opPlate ?? raw.taeCode ?? raw.taePlate ?? null
  const original = raw.duplicateOfId && raw.origLiters !== null && raw.origOccurredAt && raw.origSource
    ? { liters: raw.origLiters, occurredAt: raw.origOccurredAt, originLabel: LOAD_SOURCE_LABELS[raw.origSource as LoadSource] ?? raw.origSource }
    : null
  return {
    key: inboxRowKey("carga", raw.id),
    kind: "carga",
    id: raw.id,
    worksiteId: raw.worksiteId,
    worksiteName: raw.worksiteName,
    equipmentLabel: equipmentLabelOf(raw.vehicleCode, raw.vehiclePlate, rawEquipment),
    vehicleId: raw.vehicleId,
    title: codes.length > 0 ? flagReasonTitle(codes) : decidedStatus ? "Carga revisada" : "Carga por decidir",
    reasonCodes: codes,
    reasonLabel: codes.length > 0 ? flagReasonsLabel(codes) : "Carga por decidir",
    datum: flagDatum(codes, {
      liters: raw.liters,
      meterReading: raw.meterReading,
      meterType: raw.meterType === "hour_meter" ? "hour_meter" : raw.meterType === "odometer" ? "odometer" : null,
      performanceValue: raw.performanceValue,
      performanceUnit: unit,
      capacity: raw.capacity,
      previousReading: raw.previousReading,
      original,
      occurredAt: raw.occurredAt,
      originLabel: origin,
      rawEquipment,
      registeredAt: raw.taeSubmittedAt ?? raw.createdAt,
      range: range ? { low: range.low, high: range.high } : null,
    }),
    dataMonth: raw.month,
    dueDate: inboxDueDate(raw.month),
    waitingSince: iso(raw.createdAt),
    severity: null,
    assignee: null,
    decided: decidedStatus
      ? { outcome: raw.reviewStatus === "approved" ? "Cuenta" : "No cuenta", byName: raw.reviewerName, at: iso(raw.reviewedAt ?? raw.createdAt), note: raw.reviewNote }
      : null,
    href: fuelLoadHrefFromEquipmentLoad(raw),
    canAct: can(session, "combustibles:approve_flagged") && !raw.voidedAt,
  }
}

async function cargaRows(ctx: Ctx, view: View, limit: number, offset: number): Promise<FuelInboxRow[]> {
  const order = view === "pendientes"
    ? [asc(fuelEquipmentLoads.month), asc(fuelEquipmentLoads.createdAt), asc(fuelEquipmentLoads.id)]
    : [desc(fuelEquipmentLoads.reviewedAt), asc(fuelEquipmentLoads.id)]
  const raw = await fetchCargaRaw(cargaWhere(ctx, view), order, limit, offset)
  const ranges = await vehicleRanges(raw)
  return raw.map((row) => cargaToRow(row, ranges, ctx.session))
}

async function cargaCount(ctx: Ctx, view: View): Promise<{ n: number; oldest: string | null }> {
  const [row] = await db.select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${fuelEquipmentLoads.createdAt})` })
    .from(fuelEquipmentLoads)
    .where(cargaWhere(ctx, view))
  return { n: row?.n ?? 0, oldest: row?.oldest ? iso(row.oldest) : null }
}

/* ────────────────────────────────── Casos ────────────────────────────────────── */

const caseMonthSql = () => refMonthSql(fuelAnomalyCases.referenceEntityType, fuelAnomalyCases.referenceEntityId, fuelAnomalyCases.detectedAt)

function casoStatuses(ctx: Ctx, view: View): string[] {
  if (view === "pendientes") return ctx.filters.caseState ? [ctx.filters.caseState] : [...OPEN_CASE_STATUSES]
  if (ctx.filters.decision === "resuelto") return ["resolved"]
  if (ctx.filters.decision === "descartado") return ["dismissed"]
  return ["resolved", "dismissed"]
}

function casoWhere(ctx: Ctx, view: View): SQL | undefined {
  const reference = ctx.filters.caseReference
  return and(
    worksiteScopeSqlFor(ctx.scope, fuelAnomalyCases.worksiteId, ctx.worksiteId),
    inArray(fuelAnomalyCases.status, casoStatuses(ctx, view)),
    ctx.filters.caseSeverity ? eq(fuelAnomalyCases.severity, ctx.filters.caseSeverity) : undefined,
    reference ? and(eq(fuelAnomalyCases.referenceEntityType, reference.type), eq(fuelAnomalyCases.referenceEntityId, reference.id)) : undefined,
    view === "pendientes"
      ? lte(caseMonthSql(), ctx.lastMonth)
      : and(gte(fuelAnomalyCases.resolvedAt, ctx.range.start), lt(fuelAnomalyCases.resolvedAt, ctx.range.endExclusive)),
  )
}

async function vehicleLabels(ids: string[]): Promise<Map<string, { code: string | null; plate: string }>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate }).from(fuelVehicles).where(inArray(fuelVehicles.id, unique))
  return new Map(rows.map((row) => [row.id, { code: row.code, plate: row.plate }]))
}

function casoToRow(row: AnomalyCaseRow, month: string, labels: Map<string, { code: string | null; plate: string }>, session: Session): FuelInboxRow {
  const vehicle = row.vehicleId ? labels.get(row.vehicleId) : undefined
  const decided = row.status === "resolved" || row.status === "dismissed"
  const ruleLabel = row.ruleName ?? row.ruleCode
  return {
    key: inboxRowKey("caso", row.id),
    kind: "caso",
    id: row.id,
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    equipmentLabel: vehicle ? equipmentLabelOf(vehicle.code, vehicle.plate) : row.vehiclePlate ?? "Sin equipo",
    vehicleId: row.vehicleId,
    title: `Caso · ${ruleLabel}`,
    reasonCodes: [row.ruleCode],
    reasonLabel: ruleLabel,
    datum: row.description || ruleLabel,
    dataMonth: month,
    dueDate: inboxDueDate(month),
    waitingSince: iso(row.detectedAt),
    severity: row.severity,
    assignee: row.assigneeId ? { id: row.assigneeId, name: row.assigneeName } : null,
    decided: decided
      ? { outcome: ANOMALY_STATUS_LABELS[row.status], byName: row.resolvedByName, at: iso(row.resolvedAt ?? row.updatedAt), note: row.resolution }
      : null,
    href: hrefForEntity(row.referenceEntityType, row.referenceEntityId) ?? (row.vehicleId ? fuelEquipmentHref(row.vehicleId) : null),
    canAct: can(session, "combustibles:review_anomalies") || can(session, "combustibles:resolve_anomalies"),
  }
}

async function casoRows(ctx: Ctx, view: View, limit: number, offset: number): Promise<FuelInboxRow[]> {
  const month = caseMonthSql()
  const page = await db.select({ id: fuelAnomalyCases.id, month })
    .from(fuelAnomalyCases)
    .where(casoWhere(ctx, view))
    .orderBy(...(view === "pendientes" ? [asc(month), asc(fuelAnomalyCases.detectedAt), asc(fuelAnomalyCases.id)] : [desc(fuelAnomalyCases.resolvedAt), asc(fuelAnomalyCases.id)]))
    .limit(limit)
    .offset(offset)
  if (page.length === 0) return []
  const ids = page.map((row) => row.id)
  const { cases } = await getAnomalyCases({ ids, limit: ids.length }, ctx.session)
  const byId = new Map(cases.map((row) => [row.id, row]))
  const labels = await vehicleLabels(cases.map((row) => row.vehicleId).filter((id): id is string => Boolean(id)))
  return page.flatMap((entry) => {
    const found = byId.get(entry.id)
    return found ? [casoToRow(found, entry.month, labels, ctx.session)] : []
  })
}

async function casoCount(ctx: Ctx, view: View): Promise<{ n: number; oldest: string | null }> {
  const [row] = await db.select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${fuelAnomalyCases.detectedAt})` })
    .from(fuelAnomalyCases)
    .where(casoWhere(ctx, view))
  return { n: row?.n ?? 0, oldest: row?.oldest ? iso(row.oldest) : null }
}

/* ──────────────────────────────── Patentes ───────────────────────────────────── */

function patenteBase(ctx: Ctx): SQL | undefined {
  return and(
    isNull(fuelConsumptionRecords.vehicleId),
    eq(fuelImportBatches.estado, "importado"),
    worksiteScopeSqlFor(ctx.scope, fuelConsumptionRecords.worksiteId, ctx.worksiteId),
    lte(sql`substr(${fuelImportBatches.periodoDesde}, 1, 7)`, ctx.lastMonth),
  )
}

function patenteMappingWhere(ctx: Ctx): SQL | undefined {
  return and(
    like(fuelProviderMappings.reason, MANUAL_LINK_REASON),
    isNotNull(fuelProviderMappings.vehicleId),
    eq(fuelProviderMappings.isActive, true),
    worksiteScopeSqlFor(ctx.scope, fuelProviderMappings.worksiteId, ctx.worksiteId),
    gte(fuelProviderMappings.createdAt, ctx.range.start),
    lt(fuelProviderMappings.createdAt, ctx.range.endExclusive),
  )
}

interface PlateRaw { batchId: string; plate: string; worksiteId: string; worksiteName: string; source: string; periodFrom: string; liters: number; waiting: string }

function plateGroupSelect(where: SQL | undefined) {
  return db.select({
    batchId: fuelConsumptionRecords.batchId,
    plate: fuelConsumptionRecords.patente,
    worksiteId: fuelConsumptionRecords.worksiteId,
    worksiteName: worksites.name,
    source: fuelImportBatches.fuente,
    periodFrom: fuelImportBatches.periodoDesde,
    liters: sql<number>`coalesce(sum(${fuelConsumptionRecords.cantidadUnidad}), 0)::float8`,
    waiting: sql<string>`min(${fuelConsumptionRecords.createdAt})`,
  })
    .from(fuelConsumptionRecords)
    .innerJoin(fuelImportBatches, eq(fuelImportBatches.id, fuelConsumptionRecords.batchId))
    .innerJoin(worksites, eq(worksites.id, fuelConsumptionRecords.worksiteId))
    .where(where)
    .groupBy(fuelConsumptionRecords.batchId, fuelConsumptionRecords.patente, fuelConsumptionRecords.worksiteId, worksites.name, fuelImportBatches.fuente, fuelImportBatches.periodoDesde)
}

function patenteToRow(row: PlateRaw, canLink: boolean): FuelInboxRow {
  const month = row.periodFrom.slice(0, 7)
  const id = `tarjeta:${row.batchId}:${row.plate}`
  return {
    key: inboxRowKey("patente", id),
    kind: "patente",
    id,
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    equipmentLabel: row.plate,
    vehicleId: null,
    title: "Patente sin vincular",
    reasonCodes: ["unlinked_plate"],
    reasonLabel: "Patente sin vincular",
    datum: `${fmt(row.liters, 0)} L de ${monthName(month)} no cuentan en ningún equipo (${row.source})`,
    dataMonth: month,
    dueDate: inboxDueDate(month),
    waitingSince: iso(row.waiting),
    severity: null,
    assignee: null,
    decided: null,
    href: fuelBatchHref("tarjeta", row.batchId),
    canAct: canLink,
  }
}

async function linkedPlateRows(ctx: Ctx, limit: number, offset: number): Promise<FuelInboxRow[]> {
  const decider = alias(users, "decider")
  const rows = await db.select({
    id: fuelProviderMappings.id,
    key: fuelProviderMappings.externalKey,
    worksiteId: fuelProviderMappings.worksiteId,
    worksiteName: worksites.name,
    vehicleId: fuelProviderMappings.vehicleId,
    vehicleCode: fuelVehicles.code,
    vehiclePlate: fuelVehicles.plate,
    byName: decider.name,
    createdAt: fuelProviderMappings.createdAt,
    effectiveFrom: fuelProviderMappings.effectiveFrom,
  })
    .from(fuelProviderMappings)
    .innerJoin(worksites, eq(worksites.id, fuelProviderMappings.worksiteId))
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelProviderMappings.vehicleId))
    .leftJoin(decider, eq(decider.id, fuelProviderMappings.decidedBy))
    .where(patenteMappingWhere(ctx))
    .orderBy(desc(fuelProviderMappings.createdAt), asc(fuelProviderMappings.id))
    .limit(limit)
    .offset(offset)
  return rows.map((row) => {
    const month = row.effectiveFrom.slice(0, 7)
    const id = `vinculo:${row.id}`
    return {
      key: inboxRowKey("patente", id),
      kind: "patente" as const,
      id,
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName,
      equipmentLabel: row.key,
      vehicleId: row.vehicleId,
      title: "Patente sin vincular",
      reasonCodes: ["unlinked_plate"],
      reasonLabel: "Patente sin vincular",
      datum: `Vinculada a ${equipmentLabelOf(row.vehicleCode, row.vehiclePlate)}; las próximas actualizaciones de la tarjeta usan el mismo vínculo`,
      dataMonth: month,
      dueDate: inboxDueDate(month),
      waitingSince: iso(row.createdAt),
      severity: null,
      assignee: null,
      decided: { outcome: "Vinculada", byName: row.byName, at: iso(row.createdAt), note: null },
      href: row.vehicleId ? fuelEquipmentHref(row.vehicleId) : null,
      canAct: false,
    }
  })
}

async function patenteRows(ctx: Ctx, view: View, limit: number, offset: number): Promise<FuelInboxRow[]> {
  if (view === "decididas") return linkedPlateRows(ctx, limit, offset)
  const canLink = can(ctx.session, "combustibles:manage_vehicles")
  const rows = await plateGroupSelect(patenteBase(ctx))
    .orderBy(asc(fuelImportBatches.periodoDesde), asc(sql`min(${fuelConsumptionRecords.createdAt})`), asc(fuelConsumptionRecords.batchId), asc(fuelConsumptionRecords.patente))
    .limit(limit)
    .offset(offset)
  return rows.map((row) => patenteToRow(row, canLink))
}

async function patenteCount(ctx: Ctx, view: View): Promise<{ n: number; oldest: string | null }> {
  if (view === "decididas") {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(fuelProviderMappings).where(patenteMappingWhere(ctx))
    return { n: row?.n ?? 0, oldest: null }
  }
  const [row] = await db.select({
    n: sql<number>`count(distinct (${fuelConsumptionRecords.batchId} || ':' || ${fuelConsumptionRecords.patente}))::int`,
    oldest: sql<string | null>`min(${fuelConsumptionRecords.createdAt})`,
  })
    .from(fuelConsumptionRecords)
    .innerJoin(fuelImportBatches, eq(fuelImportBatches.id, fuelConsumptionRecords.batchId))
    .where(patenteBase(ctx))
  return { n: row?.n ?? 0, oldest: row?.oldest ? iso(row.oldest) : null }
}

/* ───────────────────────────────── Pedidos ───────────────────────────────────── */

const requester = alias(users, "requester")
const resolver = alias(users, "resolver")
const markMonthSql = () => refMonthSql(fuelReviewMarks.entityType, fuelReviewMarks.entityId, fuelReviewMarks.createdAt)

function pedidoWhere(ctx: Ctx, view: View): SQL | undefined {
  return and(
    worksiteScopeSqlFor(ctx.scope, fuelReviewMarks.worksiteId, ctx.worksiteId),
    view === "pendientes"
      ? and(eq(fuelReviewMarks.status, "open"), lte(markMonthSql(), ctx.lastMonth))
      : and(eq(fuelReviewMarks.status, "resolved"), gte(fuelReviewMarks.resolvedAt, ctx.range.start), lt(fuelReviewMarks.resolvedAt, ctx.range.endExclusive)),
  )
}

interface RefInfo { equipmentLabel: string; vehicleId: string | null; liters: number | null }
interface RefRow { id: string; vehicleId: string | null; code: string | null; plate: string | null; rawCode: string | null; rawPlate: string | null; liters: number }

/** Equipo y litros del registro al que apunta cada pedido (referencia polimórfica). */
async function hydrateRefs(refs: { entityType: string; entityId: string }[]): Promise<Map<string, RefInfo>> {
  const out = new Map<string, RefInfo>()
  const idsOf = (type: string) => [...new Set(refs.filter((ref) => ref.entityType === type).map((ref) => ref.entityId))]
  const taeIds = idsOf("fuel_tae_submission")
  const opIds = idsOf("fuel_operation_record")
  const loadIds = idsOf("fuel_load")
  const [tae, ops, loads] = await Promise.all([
    taeIds.length === 0 ? Promise.resolve<RefRow[]>([]) : db.select({ id: fuelTaeSubmissions.id, vehicleId: fuelTaeSubmissions.vehicleId, code: fuelVehicles.code, plate: fuelVehicles.plate, rawCode: fuelTaeSubmissions.equipmentCodeSnapshot, rawPlate: fuelTaeSubmissions.plateSnapshot, liters: fuelTaeSubmissions.liters })
      .from(fuelTaeSubmissions).leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelTaeSubmissions.vehicleId)).where(inArray(fuelTaeSubmissions.id, taeIds)),
    opIds.length === 0 ? Promise.resolve<RefRow[]>([]) : db.select({ id: fuelOperationRecords.id, vehicleId: fuelOperationRecords.vehicleId, code: fuelVehicles.code, plate: fuelVehicles.plate, rawCode: fuelOperationRecords.code, rawPlate: fuelOperationRecords.plate, liters: fuelOperationRecords.liters })
      .from(fuelOperationRecords).leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelOperationRecords.vehicleId)).where(inArray(fuelOperationRecords.id, opIds)),
    loadIds.length === 0 ? Promise.resolve<RefRow[]>([]) : db.select({ id: fuelLoads.id, vehicleId: fuelLoads.vehicleId, code: fuelVehicles.code, plate: fuelVehicles.plate, rawCode: sql<string | null>`null`, rawPlate: sql<string | null>`null`, liters: fuelLoads.liters })
      .from(fuelLoads).leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelLoads.vehicleId)).where(inArray(fuelLoads.id, loadIds)),
  ])
  const add = (type: string, rows: RefRow[]) => {
    for (const row of rows) out.set(`${type}:${row.id}`, { equipmentLabel: equipmentLabelOf(row.code, row.plate, row.rawCode ?? row.rawPlate), vehicleId: row.vehicleId, liters: row.liters })
  }
  add("fuel_tae_submission", tae)
  add("fuel_operation_record", ops)
  add("fuel_load", loads)
  return out
}

async function pedidoSelect(where: SQL | undefined, order: SQL[], limit: number, offset: number) {
  return db.select({
    id: fuelReviewMarks.id,
    entityType: fuelReviewMarks.entityType,
    entityId: fuelReviewMarks.entityId,
    worksiteId: fuelReviewMarks.worksiteId,
    worksiteName: worksites.name,
    notes: fuelReviewMarks.notes,
    status: fuelReviewMarks.status,
    createdAt: fuelReviewMarks.createdAt,
    resolvedAt: fuelReviewMarks.resolvedAt,
    resolutionNote: fuelReviewMarks.resolutionNote,
    requestedByName: requester.name,
    resolvedByName: resolver.name,
    month: markMonthSql(),
  })
    .from(fuelReviewMarks)
    .leftJoin(worksites, eq(worksites.id, fuelReviewMarks.worksiteId))
    .innerJoin(requester, eq(requester.id, fuelReviewMarks.markedBy))
    .leftJoin(resolver, eq(resolver.id, fuelReviewMarks.resolvedBy))
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .offset(offset)
}

type PedidoRaw = Awaited<ReturnType<typeof pedidoSelect>>[number]

function pedidoToRow(raw: PedidoRaw, refs: Map<string, RefInfo>, session: Session): FuelInboxRow {
  const ref = refs.get(`${raw.entityType}:${raw.entityId}`)
  const requested = raw.requestedByName ?? "Alguien"
  return {
    key: inboxRowKey("pedido", raw.id),
    kind: "pedido",
    id: raw.id,
    worksiteId: raw.worksiteId,
    worksiteName: raw.worksiteName,
    equipmentLabel: ref?.equipmentLabel ?? EQUIPMENT_UNKNOWN,
    vehicleId: ref?.vehicleId ?? null,
    title: "Pedida por una persona",
    reasonCodes: ["review_request"],
    reasonLabel: "Pedida por una persona",
    datum: raw.notes?.trim() ? `${requested}: «${raw.notes.trim()}»` : `${requested} pidió que la revisen, sin nota`,
    dataMonth: raw.month,
    dueDate: inboxDueDate(raw.month),
    waitingSince: iso(raw.createdAt),
    severity: null,
    assignee: null,
    decided: raw.status === "resolved"
      ? { outcome: "Revisado", byName: raw.resolvedByName, at: iso(raw.resolvedAt ?? raw.createdAt), note: raw.resolutionNote }
      : null,
    href: hrefForEntity(raw.entityType, raw.entityId),
    canAct: can(session, "combustibles:tae_review") || can(session, "combustibles:approve_flagged"),
  }
}

async function pedidoRows(ctx: Ctx, view: View, limit: number, offset: number): Promise<FuelInboxRow[]> {
  const order = view === "pendientes"
    ? [asc(markMonthSql()), asc(fuelReviewMarks.createdAt), asc(fuelReviewMarks.id)]
    : [desc(fuelReviewMarks.resolvedAt), asc(fuelReviewMarks.id)]
  const raw = await pedidoSelect(pedidoWhere(ctx, view), order, limit, offset)
  const refs = await hydrateRefs(raw)
  return raw.map((row) => pedidoToRow(row, refs, ctx.session))
}

async function pedidoCount(ctx: Ctx, view: View): Promise<{ n: number; oldest: string | null }> {
  const [row] = await db.select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${fuelReviewMarks.createdAt})` })
    .from(fuelReviewMarks)
    .where(pedidoWhere(ctx, view))
  return { n: row?.n ?? 0, oldest: row?.oldest ? iso(row.oldest) : null }
}

/* ─────────────────────────────── Listado y resumen ───────────────────────────── */

const COUNTERS: Record<FuelInboxKind, (ctx: Ctx, view: View) => Promise<{ n: number; oldest: string | null }>> = {
  carga: cargaCount,
  caso: casoCount,
  patente: patenteCount,
  pedido: pedidoCount,
}
const ROWS: Record<FuelInboxKind, (ctx: Ctx, view: View, limit: number, offset: number) => Promise<FuelInboxRow[]>> = {
  carga: cargaRows,
  caso: casoRows,
  patente: patenteRows,
  pedido: pedidoRows,
}

type KindCounts = Record<FuelInboxKind, { n: number | null; oldest: string | null }>

async function countByKind(ctx: Ctx, view: View, kinds: readonly FuelInboxKind[] = FUEL_INBOX_KINDS): Promise<KindCounts> {
  const out: KindCounts = { carga: { n: null, oldest: null }, caso: { n: null, oldest: null }, patente: { n: null, oldest: null }, pedido: { n: null, oldest: null } }
  await Promise.all(kinds.map(async (kind) => {
    try {
      out[kind] = await COUNTERS[kind](ctx, view)
    } catch (error) {
      logger.error(`[combustibles/inbox] conteo de «${kind}» falló`, error)
    }
  }))
  return out
}

/** Tipos que entran en la vista según `tipo` y la decisión elegida (cada decisión sólo existe para un tipo). */
function includedKinds(filters: FuelInboxQueryFilters): FuelInboxKind[] {
  const byDecision = filters.view === "decididas" ? decisionKindsFor(filters.decision) : [...FUEL_INBOX_KINDS]
  return filters.kind ? byDecision.filter((kind) => kind === filters.kind) : byDecision
}

/** Pendientes: todo lo cuyo mes del dato es ≤ fin del período (lo vencido sigue apareciendo). Decididas: decididas dentro del período. */
export async function getFuelInbox(session: Session, period: ResolvedFuelPeriod, filters: FuelInboxQueryFilters): Promise<FuelInboxPage> {
  const ctx = buildCtx(session, period, filters)
  const view: View = filters.view === "decididas" ? "decididas" : "pendientes"
  const pageSize = Math.min(Math.max(1, Math.floor(filters.pageSize ?? DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE)
  const kinds = includedKinds(filters)
  if (kinds.length === 0) return { rows: [], total: 0, page: 1, pageSize }

  const counts = await countByKind(ctx, view, kinds)
  const failed = kinds.find((kind) => counts[kind].n === null)
  // Una consulta caída no se lee como «no hay nada»: que lo vea la página (`settle` + banner).
  if (failed) throw new Error(`No se pudo contar lo pendiente de tipo «${failed}»`)
  const total = kinds.reduce((sum, kind) => sum + (counts[kind].n ?? 0), 0)
  const page = Math.min(Math.max(1, Math.floor(filters.page) || 1), Math.max(1, Math.ceil(total / pageSize)))
  const offset = (page - 1) * pageSize
  if (total === 0) return { rows: [], total: 0, page, pageSize }

  const only = kinds.length === 1 ? kinds[0] : undefined
  if (only) return { rows: await ROWS[only](ctx, view, pageSize, offset), total, page, pageSize }

  // Cada tipo ya viene ordenado: con las primeras `offset + pageSize` de cada uno alcanza para
  // armar la página unida sin traer todo.
  const take = offset + pageSize
  const lists = await Promise.all(kinds.filter((kind) => (counts[kind].n ?? 0) > 0).map((kind) => ROWS[kind](ctx, view, take, 0)))
  const byDecidedAt = (a: FuelInboxRow, b: FuelInboxRow) => (b.decided?.at ?? "").localeCompare(a.decided?.at ?? "") || a.key.localeCompare(b.key)
  const merged = lists.flat().sort(view === "pendientes" ? compareInboxRows : byDecidedAt)
  return { rows: merged.slice(offset, offset + pageSize), total, page, pageSize }
}

/** Conteo por tipo con el mismo criterio de `getFuelInbox`; el valor de un tipo cuya consulta falló es `null`, nunca cero. */
export async function summarizeFuelInbox(session: Session, period: ResolvedFuelPeriod, options: { worksiteId?: string } = {}): Promise<FuelInboxSummary> {
  const ctx = buildCtx(session, period, { view: "pendientes", page: 1, worksiteId: options.worksiteId })
  const counts = await countByKind(ctx, "pendientes")
  const byKind = Object.fromEntries(FUEL_INBOX_KINDS.map((kind) => [kind, counts[kind].n])) as FuelInboxSummary["byKind"]
  const values = Object.values(byKind)
  const total = values.some((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const oldest = FUEL_INBOX_KINDS.map((kind) => counts[kind].oldest).filter((value): value is string => Boolean(value)).sort()[0] ?? null
  return { total, byKind, oldestWaitingSince: oldest }
}

/** Conteos de «Decididas» por tipo, para los segmentos de esa vista (misma ventana y filtros que `getFuelInbox`). */
export async function countFuelInboxDecided(session: Session, period: ResolvedFuelPeriod, filters: FuelInboxQueryFilters): Promise<Record<FuelInboxKind, number | null>> {
  const ctx = buildCtx(session, period, { ...filters, view: "decididas" })
  const included = decisionKindsFor(filters.decision)
  const counts = await countByKind(ctx, "decididas", included)
  return Object.fromEntries(FUEL_INBOX_KINDS.map((kind) => [kind, included.includes(kind) ? counts[kind].n : 0])) as Record<FuelInboxKind, number | null>
}

/**
 * Pendientes de toda la bandeja por tipo, sin período. Es el mismo criterio de
 * «Pendientes» sin tope de mes: lo que existe no tiene un mes del dato futuro.
 * De aquí salen el contador del menú (`countFuelInboxPending`) y el tile
 * «Combustible por revisar» del Panel operacional, para que las dos cifras
 * cuenten lo mismo.
 *
 * El valor de un tipo cuya consulta falló es `null`, nunca cero: quien lo pinta
 * decide qué hacer con un dato que falta.
 */
export async function getFuelInboxPendingByKind(scope: Scope): Promise<Record<FuelInboxKind, number | null>> {
  const ctx: Ctx = {
    session: { user: { permissions: [], worksiteIds: scope === "all" ? [] : scope } } as unknown as Session,
    scope,
    lastMonth: "9999-12",
    range: OPEN_ENDED_RANGE,
    filters: { view: "pendientes", page: 1 },
  }
  const counts = await countByKind(ctx, "pendientes")
  return Object.fromEntries(FUEL_INBOX_KINDS.map((kind) => [kind, counts[kind].n])) as Record<FuelInboxKind, number | null>
}

/** Lo mismo dentro de las faenas que ve la sesión (`serviceWorksiteScope`): quien tiene la sesión no repite cómo se deriva el alcance. */
export async function getFuelInboxPendingForSession(session: Session): Promise<Record<FuelInboxKind, number | null>> {
  return getFuelInboxPendingByKind(serviceWorksiteScope(session))
}

/**
 * Pendientes de toda la bandeja, sin período, para el contador del menú
 * (`app/(app)/layout.tsx`). Un tipo cuya consulta falló suma 0: el menú no se
 * cae por eso (el tile del Panel, en cambio, dice «Sin dato»).
 */
export async function countFuelInboxPending(scope: Scope): Promise<number> {
  const byKind = await getFuelInboxPendingByKind(scope)
  return FUEL_INBOX_KINDS.reduce((sum, kind) => sum + (byKind[kind] ?? 0), 0)
}

/* ──────────────────────────────── Pie de la bandeja ──────────────────────────── */

export interface FuelDetectionRun {
  at: string
  status: "running" | "completed" | "failed"
  casesCreated: number
}

/** Última corrida de la revisión automática (las reglas corren juntas: se toma la más reciente de todas). */
export async function getLastDetectionRun(): Promise<FuelDetectionRun | null> {
  const [row] = await db.select({
    startedAt: fuelAnomalyExecutions.startedAt,
    completedAt: fuelAnomalyExecutions.completedAt,
    status: fuelAnomalyExecutions.status,
    casesCreated: fuelAnomalyExecutions.casesCreated,
  }).from(fuelAnomalyExecutions).orderBy(desc(fuelAnomalyExecutions.startedAt)).limit(1)
  if (!row) return null
  return { at: iso(row.completedAt ?? row.startedAt), status: row.status as FuelDetectionRun["status"], casesCreated: row.casesCreated }
}

/** Faenas dentro del alcance de la sesión, para el filtro de faena. */
export async function listInboxWorksites(session: Session): Promise<{ id: string; name: string }[]> {
  const scope = serviceWorksiteScope(session)
  if (scope !== "all" && scope.length === 0) return []
  return db.select({ id: worksites.id, name: worksites.name }).from(worksites)
    .where(scope === "all" ? undefined : inArray(worksites.id, scope))
    .orderBy(worksites.name)
}

/* ───────────────────────────────── Detalle ───────────────────────────────────── */

async function cargaEvidence(raw: CargaRaw, ranges: Map<string, RangeInfo>, row: FuelInboxRow): Promise<FuelInboxEvidence[]> {
  const evidence: FuelInboxEvidence[] = []
  const unit: "km" | "h" = raw.meterType === "hour_meter" ? "h" : "km"
  const perfUnit = raw.performanceUnit === "km_per_liter" || raw.performanceUnit === "liters_per_hour" ? (raw.performanceUnit as PerformanceUnit) : null
  const context = row.reasonCodes.includes("duplicate") ? await loadPerformanceControlContext(db) : null
  const ordered = [...row.reasonCodes].sort((a, b) => (primaryFlagReason([a, b]) === a ? -1 : 1))

  for (const code of ordered) {
    switch (code) {
      case "meter_regression": {
        if (!raw.vehicleId || raw.meterReading === null) break
        const readable = and(eq(fuelEquipmentLoads.vehicleId, raw.vehicleId), isNotNull(fuelEquipmentLoads.meterReading), isNull(fuelEquipmentLoads.voidedAt), inArray(fuelEquipmentLoads.performanceStatus, ANCHOR_STATUSES))
        const [before, after] = await Promise.all([
          db.select({ at: fuelEquipmentLoads.occurredAt, reading: fuelEquipmentLoads.meterReading }).from(fuelEquipmentLoads)
            .where(and(readable, lt(fuelEquipmentLoads.occurredAt, raw.occurredAt))).orderBy(desc(fuelEquipmentLoads.occurredAt)).limit(3),
          db.select({ at: fuelEquipmentLoads.occurredAt, reading: fuelEquipmentLoads.meterReading }).from(fuelEquipmentLoads)
            .where(and(readable, gt(fuelEquipmentLoads.occurredAt, raw.occurredAt))).orderBy(asc(fuelEquipmentLoads.occurredAt)).limit(1),
        ])
        evidence.push({
          type: "readings",
          unit,
          points: [
            ...before.reverse().map((point) => ({ at: iso(point.at), reading: point.reading ?? 0, current: false })),
            { at: iso(raw.occurredAt), reading: raw.meterReading, current: true },
            ...after.map((point) => ({ at: iso(point.at), reading: point.reading ?? 0, current: false })),
          ],
        })
        break
      }
      case "duplicate": {
        if (!raw.duplicateOfId || raw.origLiters === null || !raw.origOccurredAt || !raw.origSource || !context) break
        evidence.push({
          type: "duplicate",
          loads: [
            {
              at: iso(raw.origOccurredAt),
              liters: raw.origLiters,
              reading: null,
              originLabel: LOAD_SOURCE_LABELS[raw.origSource as LoadSource] ?? raw.origSource,
              href: fuelLoadHrefFromEquipmentLoad({ source: raw.origSource, taeSubmissionId: raw.origTaeSubmissionId, operationRecordId: raw.origOperationRecordId }),
            },
            { at: iso(raw.occurredAt), liters: raw.liters, reading: raw.meterReading, originLabel: LOAD_SOURCE_LABELS[raw.source as LoadSource] ?? raw.source, href: row.href },
          ],
          windowMinutes: context.settings.duplicateWindowMinutes,
          litersTolerance: context.settings.duplicateLitersTolerance,
        })
        break
      }
      case "over_capacity":
        if (raw.capacity !== null) evidence.push({ type: "capacity", liters: raw.liters, capacity: raw.capacity })
        break
      case "outlier": {
        const range = raw.vehicleId ? ranges.get(raw.vehicleId) : undefined
        if (range && raw.performanceValue !== null && perfUnit) {
          evidence.push({ type: "range", value: raw.performanceValue, unit: PERFORMANCE_UNIT_LABELS[perfUnit], low: range.low, high: range.high, samples: range.samples, lowerIsBetter: perfUnit === "liters_per_hour" })
        }
        break
      }
      case "implausible":
        if (raw.performanceValue !== null && perfUnit) {
          evidence.push({ type: "text", text: `El rendimiento calculado es ${fmt(raw.performanceValue, 2)} ${PERFORMANCE_UNIT_LABELS[perfUnit]}: ${PERFORMANCE_UNIT_TITLES[perfUnit].toLowerCase()}. Está fuera de lo que un equipo así puede rendir; casi siempre es una lectura o unos litros mal anotados.` })
        }
        break
      case "late_entry":
        evidence.push({ type: "late_entry", loadedAt: iso(raw.occurredAt), registeredAt: iso(raw.taeSubmittedAt ?? raw.createdAt), reason: raw.taeBackdateReason ?? "" })
        break
      case "unknown_vehicle":
        evidence.push({ type: "text", text: `${row.datum}. Hasta que tenga ficha, sus litros no se asignan a ningún equipo.` })
        break
      case "filler_value":
        evidence.push({ type: "text", text: "La carga trae una fecha o un sello inventados para rellenar el campo (por ejemplo 30-12-1899 o 777777). Queda fuera de la serie del equipo hasta que alguien decida." })
        break
      default:
        break
    }
  }
  return evidence
}

/** Personas que pueden hacerse cargo de un caso de esta faena. */
async function caseAssignees(worksiteId: string | null): Promise<{ id: string; name: string }[]> {
  if (!worksiteId) return []
  const ids = await getUserIdsWithPermissionForWorksite("combustibles:review_anomalies", worksiteId)
  if (ids.length === 0) return []
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(and(inArray(users.id, ids), eq(users.isActive, true))).orderBy(users.name)
  return rows.map((row) => ({ id: row.id, name: row.name ?? "Sin nombre" }))
}

/** Equipos de la faena del lote a los que se puede vincular una patente (la acción exige la misma faena). */
async function vehicleOptionsFor(session: Session, worksiteId: string) {
  const scope = serviceWorksiteScope(session)
  if (scope !== "all" && !scope.includes(worksiteId)) return []
  const rows = await db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, brand: fuelVehicles.brand, model: fuelVehicles.model })
    .from(fuelVehicles)
    .where(and(eq(fuelVehicles.worksiteId, worksiteId), eq(fuelVehicles.isActive, true)))
    .orderBy(fuelVehicles.code, fuelVehicles.plate)
  return rows.map((row) => ({ value: row.id, label: equipmentLabelOf(row.code, row.plate), hint: [row.brand, row.model].filter(Boolean).join(" ") || undefined }))
}

/** Fila, evidencia por motivo e historial de un pendiente o de algo ya decidido. `null` si no existe o está fuera del alcance. */
export async function getFuelInboxItem(session: Session, key: string): Promise<FuelInboxItem | null> {
  const parsed = parseInboxRowKey(key)
  if (!parsed) return null
  const scope = serviceWorksiteScope(session)

  if (parsed.kind === "carga") {
    const [raw] = await fetchCargaRaw(and(eq(fuelEquipmentLoads.id, parsed.id), worksiteScopeSqlFor(scope, fuelEquipmentLoads.worksiteId)), [asc(fuelEquipmentLoads.id)], 1, 0)
    if (!raw) return null
    const ranges = await vehicleRanges([raw])
    const row = cargaToRow(raw, ranges, session)
    return {
      row,
      evidence: await cargaEvidence(raw, ranges, row),
      history: [],
      extras: { load: { id: raw.id, reviewStatus: raw.reviewStatus as "ok" | "flagged" | "approved" | "rejected", voided: Boolean(raw.voidedAt), hasVehicle: Boolean(raw.vehicleId) } },
    }
  }

  if (parsed.kind === "caso") {
    const { cases } = await getAnomalyCases({ ids: [parsed.id], limit: 1 }, session)
    const found = cases[0]
    if (!found) return null
    const [monthRow] = await db.select({ month: caseMonthSql() }).from(fuelAnomalyCases).where(eq(fuelAnomalyCases.id, found.id)).limit(1)
    const labels = await vehicleLabels(found.vehicleId ? [found.vehicleId] : [])
    const row = casoToRow(found, monthRow?.month ?? found.detectedAt.slice(0, 7), labels, session)
    const text = [found.description, found.observedValue ? `Observado: ${found.observedValue}.` : null, found.expectedValue ? `Esperado: ${found.expectedValue}.` : null].filter(Boolean).join(" ")
    const evidence: FuelInboxEvidence[] = [{ type: "text", text }]
    if (found.resolution) evidence.push({ type: "text", text: `Motivo del cierre: ${found.resolution}` })
    const history = [
      { at: iso(found.detectedAt), byName: null, text: "La revisión automática abrió el caso." },
      ...found.comments.map((comment) => ({ at: iso(comment.createdAt), byName: comment.userName, text: comment.body })),
    ]
    const extras: FuelInboxItemExtras = {
      case: { id: found.id, status: found.status, severity: found.severity, ruleCode: found.ruleCode, ruleName: found.ruleName, resolutionKind: found.resolutionKind, assigneeId: found.assigneeId },
      assignees: can(session, "combustibles:review_anomalies") && found.status === "in_review" ? await caseAssignees(found.worksiteId) : undefined,
    }
    return { row, evidence, history, extras }
  }

  if (parsed.kind === "patente") {
    if (parsed.id.startsWith("vinculo:")) {
      const rows = await linkedPlateRows({ session, scope, lastMonth: "9999-12", range: OPEN_ENDED_RANGE, filters: { view: "decididas", page: 1 } }, 5000, 0)
      const row = rows.find((candidate) => candidate.id === parsed.id)
      return row ? { row, evidence: [{ type: "text", text: `${row.datum}.` }], history: [], extras: {} } : null
    }
    const [, batchId, ...plateParts] = parsed.id.split(":")
    const plate = plateParts.join(":")
    if (!batchId || !plate) return null
    const [found] = await plateGroupSelect(and(
      eq(fuelConsumptionRecords.batchId, batchId),
      eq(fuelConsumptionRecords.patente, plate),
      isNull(fuelConsumptionRecords.vehicleId),
      eq(fuelImportBatches.estado, "importado"),
      worksiteScopeSqlFor(scope, fuelConsumptionRecords.worksiteId),
    ))
    if (!found) return null
    const canLink = can(session, "combustibles:manage_vehicles")
    const row = patenteToRow(found, canLink)
    return {
      row,
      evidence: [{ type: "text", text: `El reporte «${found.source}» informa la patente ${found.plate}, pero ningún equipo de ${found.worksiteName} tiene esa patente. ${fmt(found.liters, 0)} L de ${monthName(row.dataMonth)} no cuentan en ningún equipo.` }],
      history: [],
      extras: { plate: { batchId: found.batchId, plate: found.plate, worksiteId: found.worksiteId, source: found.source, vehicleOptions: canLink ? await vehicleOptionsFor(session, found.worksiteId) : [] } },
    }
  }

  const [raw] = await pedidoSelect(and(eq(fuelReviewMarks.id, parsed.id), worksiteScopeSqlFor(scope, fuelReviewMarks.worksiteId)), [asc(fuelReviewMarks.id)], 1, 0)
  if (!raw) return null
  const refs = await hydrateRefs([raw])
  const row = pedidoToRow(raw, refs, session)
  const ref = refs.get(`${raw.entityType}:${raw.entityId}`)
  const evidence: FuelInboxEvidence[] = [{
    type: "text",
    text: ref?.liters != null ? `La carga de ${row.equipmentLabel} es de ${fmt(ref.liters)} L, de ${monthName(raw.month)}.` : "El registro de la carga ya no está disponible.",
  }]
  const history: FuelInboxItemDetail["history"] = [{ at: iso(raw.createdAt), byName: raw.requestedByName, text: raw.notes?.trim() || "Pidió que la revisen, sin nota." }]
  if (raw.status === "resolved") history.push({ at: iso(raw.resolvedAt ?? raw.createdAt), byName: raw.resolvedByName, text: raw.resolutionNote ?? "Revisado." })
  return {
    row,
    evidence,
    history,
    extras: { request: { id: raw.id, status: raw.status as "open" | "resolved" | "withdrawn", requestedByName: raw.requestedByName, note: raw.notes } },
  }
}

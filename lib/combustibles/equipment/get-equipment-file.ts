import type { Session } from "next-auth"
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelAnomalyCases,
  fuelAnomalyRules,
  fuelEquipmentLoads,
  fuelEquipmentTypes,
  fuelReviewMarks,
  fuelSuppliers,
  fuelTaeSubmissions,
  fuelVehicles,
  worksites,
} from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import {
  DEFAULT_PERFORMANCE_CONTROL_SETTINGS,
  FLAG_REASON_LABELS,
  PERFORMANCE_FAMILIES,
  PERFORMANCE_STATUS_LABELS,
  type FlagReason,
  type PerformanceFamily,
  type PerformanceStatus,
  type PerformanceUnit,
} from "@/lib/combustibles/control/contracts"
import { buildLoadWhere, chileDateSql, countableLoadSql, statisticallyValidLoadSql } from "@/lib/combustibles/control/filters"
import { dailyTelemetry } from "@/lib/combustibles/control/queries/idle"
import { getEquipmentStats } from "@/lib/combustibles/control/queries/performance"
import { controlFiltersFromPeriod } from "@/lib/combustibles/control/queries/period-filters"
import { loadPerformanceControlContext, thresholdForEquipmentType } from "@/lib/combustibles/control/settings"
import { shiftPlainDateByMonths } from "@/lib/combustibles/control/view-helpers"
import { idlePct } from "@/lib/combustibles/control/calc/idle"
import { ANOMALY_RULE_CATALOG } from "@/lib/combustibles/anomaly-rule-catalog"
import type { AnomalySeverity } from "@/lib/combustibles/anomaly-labels"
import { FUEL_LOAD_ORIGIN_LABEL, TAE_SUBMISSION_SOURCE_TO_ORIGIN } from "@/lib/combustibles/fuel-log-shared"
import { TAE_STATUS_LABELS } from "@/lib/combustibles/labels"
import { toChileInstantRange } from "@/lib/combustibles/period/adapters"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { fuelInboxHref, fuelLoadHrefFromEquipmentLoad } from "@/lib/combustibles/routes"
import { inboxRowKey } from "@/lib/combustibles/inbox/types"
import { logger } from "@/lib/logger"
import { formatQty } from "@/lib/utils"
import { fillLitersByMonth, litersMonthKeys } from "./liters-by-month"
import { computeNormalRange, isOutOfRange, outOfRangeRun, regularityOf } from "./normal-range"
import type {
  EquipmentFile,
  EquipmentFileCaseItem,
  EquipmentFileIdle,
  EquipmentFileLitersMonth,
  EquipmentFileLoad,
  EquipmentFileLoads,
  EquipmentFilePerformance,
  EquipmentFileSeals,
  EquipmentFileVehicle,
} from "./types"

/** Cuántas cargas recientes muestra la ficha antes de mandar a «Cargas». */
export const EQUIPMENT_FILE_LOAD_ROWS = 10
/** Cuántos puntos tiene el gráfico «carga a carga». */
export const EQUIPMENT_FILE_SERIES_POINTS = 12
/** Tope de cada lista de la sección «Pendiente». */
const CASE_LIMIT = 20
const SEAL_ISSUE_LIMIT = 5

const toNumber = (value: unknown): number => Number(value ?? 0)

const RULE_NAMES: Record<string, string> = Object.fromEntries(ANOMALY_RULE_CATALOG.map((rule) => [rule.code, rule.name]))

function familyOf(value: string | null): PerformanceFamily | null {
  return PERFORMANCE_FAMILIES.includes(value as PerformanceFamily) ? (value as PerformanceFamily) : null
}

/**
 * El equipo, si existe y está dentro del alcance de faena de quien consulta.
 * `null` en ambos casos: una ficha ajena no debe confirmar que el equipo existe.
 */
export async function getEquipmentVehicle(session: Session, vehicleId: string): Promise<EquipmentFileVehicle | null> {
  const [row] = await db.select({
    id: fuelVehicles.id,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    brand: fuelVehicles.brand,
    model: fuelVehicles.model,
    year: fuelVehicles.year,
    typeName: fuelEquipmentTypes.name,
    typeSlug: fuelEquipmentTypes.slug,
    family: fuelEquipmentTypes.performanceFamily,
    unit: fuelVehicles.performanceUnit,
    meterType: fuelVehicles.meterType,
    tankCapacityLiters: fuelVehicles.tankCapacityLiters,
    worksiteId: fuelVehicles.worksiteId,
    worksiteName: worksites.name,
    supplierName: fuelSuppliers.name,
    isActive: fuelVehicles.isActive,
  }).from(fuelVehicles)
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .leftJoin(fuelSuppliers, eq(fuelSuppliers.id, fuelVehicles.usualFuelSupplierId))
    .where(and(eq(fuelVehicles.id, vehicleId), worksiteScopeSql(session, fuelVehicles.worksiteId)))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    code: row.code,
    plate: row.plate,
    label: row.code ? `${row.code} · ${row.plate}` : row.plate,
    brand: row.brand,
    model: row.model,
    year: row.year,
    typeName: row.typeName,
    typeSlug: row.typeSlug,
    family: familyOf(row.family),
    unit: row.unit === "km_per_liter" || row.unit === "liters_per_hour" ? row.unit : null,
    meterType: row.meterType === "odometer" || row.meterType === "hour_meter" ? row.meterType : "none",
    tankCapacityLiters: row.tankCapacityLiters === null ? null : toNumber(row.tankCapacityLiters),
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    usualSupplierName: row.supplierName,
    isActive: row.isActive,
  }
}

/**
 * La ficha de un equipo en un período: sus cargas, su rendimiento contra su
 * modelo y contra sus 12 meses, los litros de cada uno de esos meses, el motor
 * en vacío, la cadena de sellos y lo que está pendiente. `null` si el equipo no
 * existe o queda fuera del alcance de faena de la sesión. Cada sección se
 * consulta aparte: si una falla, la ficha sigue y `degraded` dice cuál (nunca
 * un cero falso).
 *
 * Los sellos son un dato de terreno: sólo con `combustibles:tae_view`. No
 * lleva nombres de personas ni montos.
 */
export async function getEquipmentFile(session: Session, vehicleId: string, period: ResolvedFuelPeriod): Promise<EquipmentFile | null> {
  const vehicle = await getEquipmentVehicle(session, vehicleId)
  if (!vehicle) return null

  const degraded: string[] = []
  let sourceCount = 0
  async function track<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
    sourceCount += 1
    try {
      return await work()
    } catch (error) {
      logger.error(`[combustibles/equipo] ${label} falló`, error)
      degraded.push(label)
      return fallback
    }
  }

  const canSeeField = can(session, "combustibles:tae_view")
  const [loads, performance, litersByMonth, idle, seals, cases] = await Promise.all([
    track("cargas del período", () => getLoads(session, vehicle, period), emptyLoads()),
    vehicle.unit ? track("rendimiento", () => getPerformance(session, vehicle, vehicle.unit!, period), null) : Promise.resolve(null),
    track("litros por mes", () => getLitersByMonth(session, vehicle, period), [] as EquipmentFileLitersMonth[]),
    track("motor en vacío", () => getIdle(session, vehicle, period), null),
    canSeeField ? track("cadena de sellos", () => getSeals(session, vehicle, period), null) : Promise.resolve(null),
    track("pendientes del equipo", () => getCases(session, vehicle, period), [] as EquipmentFileCaseItem[]),
  ])

  return { vehicle, loads, performance, litersByMonth, idle, seals, cases, degraded, sourceCount }
}

function emptyLoads(): EquipmentFileLoads {
  return { count: 0, liters: 0, rows: [], hiddenCount: 0 }
}

/* ── Cargas del período ──────────────────────────────────────────────────── */

async function getLoads(session: Session, vehicle: EquipmentFileVehicle, period: ResolvedFuelPeriod): Promise<EquipmentFileLoads> {
  const filters = controlFiltersFromPeriod(period)
  const where = and(buildLoadWhere(session, filters), eq(fuelEquipmentLoads.vehicleId, vehicle.id))
  const visible = and(where, isNull(fuelEquipmentLoads.voidedAt), isNull(fuelEquipmentLoads.duplicateOfId))

  const [totals, rows] = await Promise.all([
    db.select({
      count: sql<number>`(count(*) filter (where ${countableLoadSql}))::int`,
      liters: sql<number>`coalesce(sum(${fuelEquipmentLoads.liters}) filter (where ${countableLoadSql}), 0)::float8`,
      visible: sql<number>`(count(*) filter (where ${fuelEquipmentLoads.voidedAt} is null and ${fuelEquipmentLoads.duplicateOfId} is null))::int`,
    }).from(fuelEquipmentLoads).where(where),
    db.select({
      id: fuelEquipmentLoads.id,
      source: fuelEquipmentLoads.source,
      taeSubmissionId: fuelEquipmentLoads.taeSubmissionId,
      operationRecordId: fuelEquipmentLoads.operationRecordId,
      occurredAt: fuelEquipmentLoads.occurredAt,
      liters: fuelEquipmentLoads.liters,
      meterType: fuelEquipmentLoads.meterType,
      meterReading: fuelEquipmentLoads.meterReading,
      performanceValue: fuelEquipmentLoads.performanceValue,
      performanceStatus: fuelEquipmentLoads.performanceStatus,
      reviewStatus: fuelEquipmentLoads.reviewStatus,
      submissionSource: fuelTaeSubmissions.source,
      submissionStatus: fuelTaeSubmissions.status,
    }).from(fuelEquipmentLoads)
      .leftJoin(fuelTaeSubmissions, eq(fuelTaeSubmissions.id, fuelEquipmentLoads.taeSubmissionId))
      .where(visible)
      .orderBy(desc(fuelEquipmentLoads.occurredAt), desc(fuelEquipmentLoads.id))
      .limit(EQUIPMENT_FILE_LOAD_ROWS),
  ])

  const visibleCount = toNumber(totals[0]?.visible)
  const loadRows: EquipmentFileLoad[] = rows.map((row) => {
    const isPlanilla = row.source === "operations_import"
    const origin = isPlanilla ? "planilla" : (TAE_SUBMISSION_SOURCE_TO_ORIGIN[row.submissionSource ?? ""] ?? (row.source === "legacy_tae" ? "historico" : "qr"))
    const review = (["ok", "flagged", "approved", "rejected"].includes(row.reviewStatus) ? row.reviewStatus : "ok") as EquipmentFileLoad["reviewStatus"]
    return {
      id: row.id,
      occurredAt: row.occurredAt,
      liters: toNumber(row.liters),
      meterType: row.meterType === "odometer" || row.meterType === "hour_meter" ? row.meterType : null,
      meterReading: row.meterReading === null ? null : toNumber(row.meterReading),
      performanceValue: row.performanceStatus === "computed" && row.performanceValue !== null ? toNumber(row.performanceValue) : null,
      performanceNote: row.performanceStatus === "computed" ? null : (PERFORMANCE_STATUS_LABELS[row.performanceStatus as PerformanceStatus] ?? null),
      originLabel: FUEL_LOAD_ORIGIN_LABEL[origin],
      stateLabel: row.submissionStatus ? (TAE_STATUS_LABELS[row.submissionStatus]?.label ?? null) : null,
      reviewStatus: review,
      href: fuelLoadHrefFromEquipmentLoad({ source: row.source, taeSubmissionId: row.taeSubmissionId, operationRecordId: row.operationRecordId }),
    }
  })
  return {
    count: toNumber(totals[0]?.count),
    liters: toNumber(totals[0]?.liters),
    rows: loadRows,
    hiddenCount: Math.max(0, visibleCount - loadRows.length),
  }
}

/* ── Rendimiento ─────────────────────────────────────────────────────────── */

async function getPerformance(session: Session, vehicle: EquipmentFileVehicle, unit: PerformanceUnit, period: ResolvedFuelPeriod): Promise<EquipmentFilePerformance | null> {
  const filters = controlFiltersFromPeriod(period)
  const historyFrom = shiftPlainDateByMonths(period.to, -12)

  const [stats, context, valid, excluded] = await Promise.all([
    // Mismas cifras que la tabla de «Rendimiento»: promedio del modelo sin el propio equipo e historial de 12 meses.
    getEquipmentStats(session, { ...filters, equipment: vehicle.plate }, { page: 1, pageSize: 5 }),
    loadPerformanceControlContext().catch(() => null),
    db.select({
      id: fuelEquipmentLoads.id,
      occurredAt: fuelEquipmentLoads.occurredAt,
      value: fuelEquipmentLoads.performanceValue,
      // Antes del período: es el «historial» contra el que se mide el rango normal.
      beforePeriod: sql<boolean>`${chileDateSql(fuelEquipmentLoads.occurredAt)} < ${period.from}::date`,
    })
      .from(fuelEquipmentLoads)
      .where(and(
        eq(fuelEquipmentLoads.vehicleId, vehicle.id),
        worksiteScopeSql(session, fuelEquipmentLoads.worksiteId),
        statisticallyValidLoadSql,
        sql`${chileDateSql(fuelEquipmentLoads.occurredAt)} >= ${historyFrom}::date`,
        sql`${chileDateSql(fuelEquipmentLoads.occurredAt)} <= ${period.to}::date`,
      ))
      .orderBy(asc(fuelEquipmentLoads.occurredAt), asc(fuelEquipmentLoads.id))
      .limit(1000),
    db.select({ n: sql<number>`count(*)::int` }).from(fuelEquipmentLoads)
      .where(and(
        buildLoadWhere(session, filters),
        eq(fuelEquipmentLoads.vehicleId, vehicle.id),
        countableLoadSql,
        eq(fuelEquipmentLoads.reviewStatus, "flagged"),
        eq(fuelEquipmentLoads.performanceStatus, "computed"),
      )),
  ])

  const row = stats.rows.find((candidate) => candidate.vehicleId === vehicle.id) ?? null
  // El rango normal sale de su historial previo al período (el mismo de «Su historial»): con las cargas
  // recientes dentro, una racha mala se normalizaría a sí misma. Con poco historial se usa todo lo que hay.
  const historyValues = valid.filter((load) => load.beforePeriod).map((load) => toNumber(load.value))
  const settings = context?.settings ?? DEFAULT_PERFORMANCE_CONTROL_SETTINGS
  const k = context ? thresholdForEquipmentType(context.settings, context.ruleConfig, vehicle.typeSlug) : DEFAULT_PERFORMANCE_CONTROL_SETTINGS.thresholdStdDevs
  const normalRange = computeNormalRange(historyValues, k, settings.minSamples)
    ?? computeNormalRange(valid.map((load) => toNumber(load.value)), k, settings.minSamples)
  const series = valid.slice(-EQUIPMENT_FILE_SERIES_POINTS).map((load) => {
    const value = toNumber(load.value)
    return { id: load.id, occurredAt: load.occurredAt, value, outOfRange: normalRange ? isOutOfRange(unit, value, normalRange) : false }
  })
  const excludedInReview = toNumber(excluded[0]?.n)

  // Sin cargas contables en el período ni historial que mostrar no hay nada que decir.
  if (!row && series.length === 0 && excludedInReview === 0) return null

  const { regularity, cv } = regularityOf(row?.mean ?? null, row?.sd ?? null)
  return {
    unit,
    n: row?.n ?? 0,
    mean: row?.mean ?? null,
    modelMean: row?.modelMean ?? null,
    deltaModelPct: row?.deltaModelPct ?? null,
    worseThanModel: row?.worseThanModel ?? false,
    historyMean: row?.historyMean ?? null,
    deltaHistoryPct: row?.deltaHistoryPct ?? null,
    worseThanHistory: row?.worseThanHistory ?? false,
    regularity,
    cv,
    series,
    normalRange,
    outOfRangeSince: outOfRangeRun(series),
    excludedInReview,
  }
}

/* ── Litros por mes ──────────────────────────────────────────────────────── */

/**
 * Litros de las cargas que cuentan (sin anuladas, duplicadas ni rechazadas; las
 * por decidir suman: el combustible se cargó) en cada uno de los 12 meses que
 * terminan en el del fin del período. Agrupa por la columna `month` (hora de
 * Chile) y rellena con ceros los meses sin cargas. No usa el rango de días del
 * período: es el historial para ver la evolución, y el período sólo fija dónde
 * termina.
 */
async function getLitersByMonth(session: Session, vehicle: EquipmentFileVehicle, period: ResolvedFuelPeriod): Promise<EquipmentFileLitersMonth[]> {
  const endMonth = period.to.slice(0, 7)
  const rows = await db.select({
    month: fuelEquipmentLoads.month,
    liters: sql<number>`coalesce(sum(${fuelEquipmentLoads.liters}), 0)::float8`,
    loads: sql<number>`count(*)::int`,
  }).from(fuelEquipmentLoads)
    .where(and(
      eq(fuelEquipmentLoads.vehicleId, vehicle.id),
      worksiteScopeSql(session, fuelEquipmentLoads.worksiteId),
      countableLoadSql,
      inArray(fuelEquipmentLoads.month, litersMonthKeys(endMonth)),
    ))
    .groupBy(fuelEquipmentLoads.month)
  return fillLitersByMonth(endMonth, rows.map((row) => ({ month: row.month, liters: toNumber(row.liters), loads: toNumber(row.loads) })))
}

/* ── Motor en vacío ──────────────────────────────────────────────────────── */

async function getIdle(session: Session, vehicle: EquipmentFileVehicle, period: ResolvedFuelPeriod): Promise<EquipmentFileIdle | null> {
  const d = dailyTelemetry(session, controlFiltersFromPeriod(period))
  const [row] = await db.select({
    days: sql<number>`count(*)::int`,
    operating: sql<number>`coalesce(sum(${d.operating}), 0)::float8`,
    idle: sql<number>`coalesce(sum(${d.idle}), 0)::float8`,
    litersIdle: sql<number | null>`sum(${d.litersIdle})::float8`,
    activeDays: sql<number>`(count(*) filter (where ${d.operating} > 0))::int`,
  }).from(d).where(eq(d.vehicleId, vehicle.id))
  if (!row || toNumber(row.days) === 0) return null
  return {
    operatingHours: toNumber(row.operating),
    idleHours: toNumber(row.idle),
    idlePct: idlePct(toNumber(row.idle), toNumber(row.operating)),
    litersIdle: row.litersIdle === null ? null : toNumber(row.litersIdle),
    activeDays: toNumber(row.activeDays),
  }
}

/* ── Cadena de sellos ────────────────────────────────────────────────────── */

async function getSeals(session: Session, vehicle: EquipmentFileVehicle, period: ResolvedFuelPeriod): Promise<EquipmentFileSeals | null> {
  const { start, endExclusive } = toChileInstantRange(period)
  const base = and(
    eq(fuelTaeSubmissions.vehicleId, vehicle.id),
    ne(fuelTaeSubmissions.status, "voided"),
    worksiteScopeSql(session, fuelTaeSubmissions.worksiteId),
  )
  const inPeriod = and(base, gte(fuelTaeSubmissions.loadedAt, start), lt(fuelTaeSubmissions.loadedAt, endExclusive))

  const [totals, issues, last] = await Promise.all([
    db.select({
      loads: sql<number>`count(*)::int`,
      mismatches: sql<number>`(count(*) filter (where ${fuelTaeSubmissions.sealChainStatus} = 'mismatch'))::int`,
      withoutSeal: sql<number>`(count(*) filter (where ${fuelTaeSubmissions.sealChainStatus} = 'no_seal'))::int`,
    }).from(fuelTaeSubmissions).where(inPeriod),
    db.select({
      id: fuelTaeSubmissions.id,
      loadedAt: fuelTaeSubmissions.loadedAt,
      removedSeal: fuelTaeSubmissions.removedSealNumber,
      expectedSeal: fuelTaeSubmissions.sealChainExpected,
    }).from(fuelTaeSubmissions)
      .where(and(inPeriod, eq(fuelTaeSubmissions.sealChainStatus, "mismatch")))
      .orderBy(desc(fuelTaeSubmissions.loadedAt))
      .limit(SEAL_ISSUE_LIMIT),
    db.select({ loadedAt: fuelTaeSubmissions.loadedAt, installedSeal: fuelTaeSubmissions.installedSealNumber })
      .from(fuelTaeSubmissions)
      .where(base)
      .orderBy(desc(fuelTaeSubmissions.loadedAt))
      .limit(1),
  ])

  const loads = toNumber(totals[0]?.loads)
  if (loads === 0 && !last[0]) return null
  return {
    loads,
    mismatches: toNumber(totals[0]?.mismatches),
    withoutSeal: toNumber(totals[0]?.withoutSeal),
    lastInstalledSeal: last[0]?.installedSeal ?? null,
    lastLoadAt: last[0]?.loadedAt ?? null,
    issues: issues.map((issue) => ({ submissionId: issue.id, loadedAt: issue.loadedAt, removedSeal: issue.removedSeal, expectedSeal: issue.expectedSeal })),
  }
}

/* ── Pendiente: cargas por decidir, casos y pedidos ──────────────────────── */

const ENTITY_FOR_MARK = { terreno: "fuel_tae_submission", planilla: "fuel_operation_record", factura: "fuel_load" } as const

async function getCases(session: Session, vehicle: EquipmentFileVehicle, period: ResolvedFuelPeriod): Promise<EquipmentFileCaseItem[]> {
  // Igual que la bandeja: lo vencido sigue apareciendo, así que se mira hasta el fin del período.
  const lastMonth = period.monthKeys[period.monthKeys.length - 1] ?? period.to.slice(0, 7)

  const [flagged, cases, marks] = await Promise.all([
    db.select({
      id: fuelEquipmentLoads.id,
      occurredAt: fuelEquipmentLoads.occurredAt,
      liters: fuelEquipmentLoads.liters,
      reasons: fuelEquipmentLoads.flagReasons,
    }).from(fuelEquipmentLoads)
      .where(and(
        eq(fuelEquipmentLoads.vehicleId, vehicle.id),
        worksiteScopeSql(session, fuelEquipmentLoads.worksiteId),
        countableLoadSql,
        eq(fuelEquipmentLoads.reviewStatus, "flagged"),
        lte(fuelEquipmentLoads.month, lastMonth),
      ))
      .orderBy(asc(fuelEquipmentLoads.occurredAt))
      .limit(CASE_LIMIT),
    db.select({
      id: fuelAnomalyCases.id,
      ruleCode: fuelAnomalyCases.ruleCode,
      ruleName: fuelAnomalyRules.name,
      description: fuelAnomalyCases.description,
      severity: fuelAnomalyCases.severity,
      detectedAt: fuelAnomalyCases.detectedAt,
    }).from(fuelAnomalyCases)
      .leftJoin(fuelAnomalyRules, eq(fuelAnomalyRules.id, fuelAnomalyCases.ruleId))
      .where(and(
        eq(fuelAnomalyCases.vehicleId, vehicle.id),
        inArray(fuelAnomalyCases.status, ["open", "in_review", "reopened"]),
        worksiteScopeSql(session, fuelAnomalyCases.worksiteId),
      ))
      .orderBy(asc(fuelAnomalyCases.detectedAt))
      .limit(CASE_LIMIT),
    db.select({
      id: fuelReviewMarks.id,
      notes: fuelReviewMarks.notes,
      createdAt: fuelReviewMarks.createdAt,
    }).from(fuelReviewMarks)
      .where(and(
        eq(fuelReviewMarks.status, "open"),
        worksiteScopeSql(session, fuelReviewMarks.worksiteId),
        or(
          and(
            eq(fuelReviewMarks.entityType, ENTITY_FOR_MARK.terreno),
            sql`${fuelReviewMarks.entityId} in (select tae_submission_id from fuel_equipment_loads where vehicle_id = ${vehicle.id} and tae_submission_id is not null)`,
          ),
          and(
            eq(fuelReviewMarks.entityType, ENTITY_FOR_MARK.planilla),
            sql`${fuelReviewMarks.entityId} in (select operation_record_id from fuel_equipment_loads where vehicle_id = ${vehicle.id} and operation_record_id is not null)`,
          ),
          and(
            eq(fuelReviewMarks.entityType, ENTITY_FOR_MARK.factura),
            sql`${fuelReviewMarks.entityId} in (select id from fuel_loads where vehicle_id = ${vehicle.id})`,
          ),
        ),
      ))
      .orderBy(asc(fuelReviewMarks.createdAt))
      .limit(CASE_LIMIT),
  ])

  const items: EquipmentFileCaseItem[] = [
    ...flagged.map((load): EquipmentFileCaseItem => {
      const reasons = Array.isArray(load.reasons) ? load.reasons : []
      const first = reasons[0] as FlagReason | undefined
      return {
        key: inboxRowKey("carga", load.id),
        kind: "carga",
        title: (first && FLAG_REASON_LABELS[first]) ?? "Carga por decidir",
        detail: `${formatQty(toNumber(load.liters), undefined, { maximumFractionDigits: 1 })} L${reasons.length > 1 ? ` · y ${reasons.length - 1} motivo${reasons.length - 1 === 1 ? "" : "s"} más` : ""}`,
        severity: null,
        since: load.occurredAt,
        href: fuelInboxHref({ tipo: "carga", item: inboxRowKey("carga", load.id) }),
      }
    }),
    ...cases.map((anomaly): EquipmentFileCaseItem => ({
      key: inboxRowKey("caso", anomaly.id),
      kind: "caso",
      title: anomaly.ruleName ?? RULE_NAMES[anomaly.ruleCode] ?? "Caso abierto",
      detail: anomaly.description,
      severity: (["low", "medium", "high", "critical"].includes(anomaly.severity) ? anomaly.severity : "medium") as AnomalySeverity,
      since: anomaly.detectedAt,
      href: fuelInboxHref({ tipo: "caso", item: inboxRowKey("caso", anomaly.id) }),
    })),
    ...marks.map((mark): EquipmentFileCaseItem => ({
      key: inboxRowKey("pedido", mark.id),
      kind: "pedido",
      title: "Pedido de revisión",
      detail: mark.notes,
      severity: null,
      since: mark.createdAt,
      href: fuelInboxHref({ tipo: "pedido", item: inboxRowKey("pedido", mark.id) }),
    })),
  ]
  return items.sort((left, right) => left.since.localeCompare(right.since) || left.key.localeCompare(right.key))
}

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantHistoricalScheduleChecks, mantHistoricalScheduleItems,
  mantRecordItems, mantRecordPhotos, mantRecords, worksites,
} from "@/db/schema"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { driveLink } from "@/lib/mantencion/drive-link"
import { FORMS_CUTOVER_DATE } from "@/lib/mantencion/forms-cutover"
import { recordVisibility, recordVisibilitySql, type MantViewer } from "../access"
import { unitFromMeter } from "../fleet"
import { queryFilters } from "./filters"
import { effectiveWorksiteIds } from "./resolve"
import {
  levelLabel, matrixRows, mechanicKeyOf, parseLevelValue, percentFromCounts, summarizeCompliance,
} from "./preventive-summary"
import type {
  ChecklistMatrix, ComplianceCheck, CrossDimension, LookerFilters, MatrixCheck, PreventiveCompliance, ResolvedCrossFilters,
} from "./types"

/**
 * Pestaña Preventivo. Histórico y nativo no se solapan: los formularios cuentan hasta el corte y
 * los registros firmados desde el corte (misma regla que «Trabajos de mantención»).
 *
 * El detalle por ítem del histórico viene del bloque «Detalle por ítem» del consolidado
 * (`mant_historical_schedule_items`); si una pauta no lo trae, no entra en la matriz y se informa.
 */

const HISTORICAL_DATE = sql<string>`coalesce(${mantHistoricalScheduleChecks.performedOn}, left(${mantHistoricalScheduleChecks.submittedAt}, 10))`
const HISTORICAL_MECHANIC = sql<string | null>`coalesce(${mantHistoricalScheduleChecks.mechanic}, (select f->>'value' from jsonb_array_elements(${mantHistoricalScheduleChecks.fields}) f where upper(f->>'header') like '%MECANICO%' limit 1))`
const HISTORICAL_OBSERVATIONS = sql<string | null>`coalesce(${mantHistoricalScheduleChecks.observations}, (select f->>'value' from jsonb_array_elements(${mantHistoricalScheduleChecks.fields}) f where upper(f->>'header') like '%OBSERVACIONES%' limit 1))`

interface RawCheck {
  id: string
  source: "historial" | "registro"
  date: string
  vehicleId: string | null
  code: string | null
  plate: string | null
  worksiteId: string | null
  worksiteName: string | null
  level: string | null
  levelValue: number | null
  mechanic: string | null
  done: number
  notDone: number
  notApplicable: number
  /** 0–1 (sólo el histórico lo declara). */
  declared: number | null
  unit: string | null
  observations: string | null
  filtersPhotoUrl: string | null
  stickerPhotoUrl: string | null
}

function toCheck(row: RawCheck): ComplianceCheck {
  const unit = unitFromMeter(row.unit ?? "")
  const levelValue = row.source === "historial" ? parseLevelValue(row.level) : row.levelValue
  const done = Number(row.done ?? 0)
  const notDone = Number(row.notDone ?? 0)
  const declared = row.declared == null ? null : Number(row.declared)
  const percent = percentFromCounts(done, notDone, declared)
  const mechanic = row.mechanic?.trim() || null
  const level = row.source === "historial"
    ? row.level?.trim() || "Pauta"
    : levelLabel(levelValue, unit)
  return {
    id: row.id,
    source: row.source,
    date: row.date,
    month: row.date.slice(0, 7),
    vehicleId: row.vehicleId,
    code: row.code ?? "",
    plate: row.plate ?? "",
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    level,
    levelValue,
    mechanic,
    mechanicKey: mechanicKeyOf(mechanic),
    done,
    notDone,
    notApplicable: Number(row.notApplicable ?? 0),
    percent: percent == null ? null : Math.round(percent * 10) / 10,
  }
}

/** Pautas del período con los filtros efectivos, históricas y nativas, de la más reciente a la más antigua. */
export async function loadComplianceChecks(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  ignore: readonly CrossDimension[] = [],
): Promise<ComplianceCheck[]> {
  const query = queryFilters(filters, cross, ignore)
  const scope = effectiveWorksiteIds(viewer, query.worksiteIds)
  if (scope !== "all" && scope.length === 0) return []
  const meterType = query.unit === "km" ? "odometer" : query.unit === "h" ? "hour_meter" : null
  const vehicleIds = query.equipmentIds
  const historicalCheckFilter = query.checkId
    ? query.checkId.startsWith("h:") ? eq(mantHistoricalScheduleChecks.sourceKey, query.checkId.slice(2)) : sql`false`
    : undefined
  const nativeCheckFilter = query.checkId
    ? query.checkId.startsWith("r:") ? eq(mantRecords.id, query.checkId.slice(2)) : sql`false`
    : undefined

  const historical = db.select({
    id: sql<string>`('h:' || ${mantHistoricalScheduleChecks.sourceKey})`.as("id"),
    source: sql<"historial">`'historial'::text`.as("source"),
    date: HISTORICAL_DATE.as("date"),
    vehicleId: sql<string | null>`${mantHistoricalScheduleChecks.vehicleId}`.as("vehicleId"),
    code: sql<string | null>`coalesce(${fuelVehicles.code}, ${mantHistoricalScheduleChecks.equipmentText})`.as("code"),
    plate: sql<string | null>`coalesce(${fuelVehicles.plate}, '')`.as("plate"),
    worksiteId: sql<string | null>`${mantHistoricalScheduleChecks.worksiteId}`.as("worksiteId"),
    worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
    level: sql<string | null>`${mantHistoricalScheduleChecks.scheduleLabel}`.as("level"),
    levelValue: sql<number | null>`NULL::int`.as("levelValue"),
    mechanic: HISTORICAL_MECHANIC.as("mechanic"),
    done: sql<number>`${mantHistoricalScheduleChecks.doneCount}`.as("done"),
    notDone: sql<number>`${mantHistoricalScheduleChecks.notDoneCount}`.as("notDone"),
    notApplicable: sql<number>`${mantHistoricalScheduleChecks.notApplicableCount}`.as("notApplicable"),
    declared: sql<number | null>`${mantHistoricalScheduleChecks.compliance}`.as("declared"),
    unit: sql<string | null>`${fuelEquipmentTypes.defaultMeterType}`.as("unit"),
    observations: HISTORICAL_OBSERVATIONS.as("observations"),
    filtersPhotoUrl: sql<string | null>`${mantHistoricalScheduleChecks.filtersPhotoUrl}`.as("filtersPhotoUrl"),
    stickerPhotoUrl: sql<string | null>`${mantHistoricalScheduleChecks.stickerPhotoUrl}`.as("stickerPhotoUrl"),
  })
    .from(mantHistoricalScheduleChecks)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantHistoricalScheduleChecks.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .leftJoin(worksites, eq(worksites.id, mantHistoricalScheduleChecks.worksiteId))
    .where(and(
      eq(mantHistoricalScheduleChecks.isTest, false),
      sql`${HISTORICAL_DATE} >= ${filters.from} AND ${HISTORICAL_DATE} <= ${filters.to}`,
      sql`${HISTORICAL_DATE} < ${FORMS_CUTOVER_DATE}`,
      worksiteScopeSqlFor(scope, mantHistoricalScheduleChecks.worksiteId),
      vehicleIds.length ? inArray(mantHistoricalScheduleChecks.vehicleId, vehicleIds) : undefined,
      meterType ? eq(fuelEquipmentTypes.defaultMeterType, meterType) : undefined,
      query.month ? sql`left(${HISTORICAL_DATE}, 7) = ${query.month}` : undefined,
      historicalCheckFilter,
    ))

  const native = db.select({
    id: sql<string>`('r:' || ${mantRecords.id})`.as("id"),
    source: sql<"registro">`'registro'::text`.as("source"),
    date: sql<string>`${mantRecords.workDate}`.as("date"),
    vehicleId: sql<string | null>`${mantRecords.vehicleId}`.as("vehicleId"),
    code: sql<string | null>`${fuelVehicles.code}`.as("code"),
    plate: sql<string | null>`${fuelVehicles.plate}`.as("plate"),
    worksiteId: sql<string | null>`${mantRecords.worksiteId}`.as("worksiteId"),
    worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
    level: sql<string | null>`NULL::text`.as("level"),
    levelValue: sql<number | null>`${mantRecords.intervalValue}`.as("levelValue"),
    mechanic: sql<string | null>`${mantRecords.executorName}`.as("mechanic"),
    done: sql<number>`(select count(*)::int from mant_record_items i where i.record_id = ${mantRecords.id} and i.value = 'R')`.as("done"),
    notDone: sql<number>`(select count(*)::int from mant_record_items i where i.record_id = ${mantRecords.id} and i.value = 'NR')`.as("notDone"),
    notApplicable: sql<number>`(select count(*)::int from mant_record_items i where i.record_id = ${mantRecords.id} and i.value = 'NA')`.as("notApplicable"),
    declared: sql<number | null>`NULL::numeric`.as("declared"),
    unit: sql<string | null>`${fuelEquipmentTypes.defaultMeterType}`.as("unit"),
    observations: sql<string | null>`${mantRecords.notes}`.as("observations"),
    filtersPhotoUrl: sql<string | null>`NULL::text`.as("filtersPhotoUrl"),
    stickerPhotoUrl: sql<string | null>`NULL::text`.as("stickerPhotoUrl"),
  })
    .from(mantRecords)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantRecords.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
    .where(and(
      eq(mantRecords.kind, "P"),
      eq(mantRecords.status, "vigente"),
      gte(mantRecords.workDate, FORMS_CUTOVER_DATE),
      gte(mantRecords.workDate, filters.from),
      lte(mantRecords.workDate, filters.to),
      recordVisibilitySql(recordVisibility(viewer)),
      worksiteScopeSqlFor(scope, mantRecords.worksiteId),
      vehicleIds.length ? inArray(mantRecords.vehicleId, vehicleIds) : undefined,
      meterType ? eq(fuelEquipmentTypes.defaultMeterType, meterType) : undefined,
      query.month ? sql`left(${mantRecords.workDate}, 7) = ${query.month}` : undefined,
      nativeCheckFilter,
    ))

  const [historicalRows, nativeRows] = await Promise.all([historical, native])
  let checks = [...historicalRows, ...nativeRows].map((row) => toCheck(row as RawCheck))
  if (query.mechanicKey) checks = checks.filter((check) => check.mechanicKey === query.mechanicKey)
  if (query.frequencies.length) {
    const allowed = new Set(query.frequencies)
    checks = checks.filter((check) => check.levelValue != null && allowed.has(check.levelValue))
  }
  return checks.sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code, "es", { numeric: true }))
}

export async function loadPreventiveCompliance(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  ignore: readonly CrossDimension[] = [],
): Promise<PreventiveCompliance> {
  const checks = await loadComplianceChecks(viewer, filters, cross, ignore)
  return summarizeCompliance(checks, filters.from, filters.to)
}

/* ── Matriz de checklist ─────────────────────────────────────────────────── */

type HistoricalMeta = { sourceKey: string; observations: string | null; filtersPhotoUrl: string | null; stickerPhotoUrl: string | null }
type NativeMeta = { id: string; notes: string | null }

/**
 * Últimas pautas con detalle por ítem. Los históricos sin detalle no entran como columna: se
 * cuentan en `withoutDetail` para que la UI diga cuántos quedaron fuera.
 */
export async function loadChecklistMatrix(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  ignore: readonly CrossDimension[] = [],
  limit = 8,
): Promise<ChecklistMatrix> {
  const checks = await loadComplianceChecks(viewer, filters, cross, ignore)
  const candidates = checks.slice(0, Math.max(limit * 4, 16))
  const historicalCandidates = candidates.filter((check) => check.source === "historial")
  const nativeCandidates = candidates.filter((check) => check.source === "registro")
  const historicalKeys = historicalCandidates.map((check) => check.id.slice(2))
  const nativeIds = nativeCandidates.map((check) => check.id.slice(2))

  const [historicalItems, nativeItems] = await Promise.all([
    historicalKeys.length
      ? db.select({
        checkSourceKey: mantHistoricalScheduleItems.checkSourceKey,
        itemName: mantHistoricalScheduleItems.itemName,
        result: mantHistoricalScheduleItems.result,
        sortOrder: mantHistoricalScheduleItems.sortOrder,
      }).from(mantHistoricalScheduleItems)
        .where(inArray(mantHistoricalScheduleItems.checkSourceKey, historicalKeys))
        .orderBy(mantHistoricalScheduleItems.checkSourceKey, mantHistoricalScheduleItems.sortOrder)
      : Promise.resolve([]),
    nativeIds.length
      ? db.select({
        recordId: mantRecordItems.recordId,
        itemName: mantRecordItems.itemName,
        groupName: mantRecordItems.groupName,
        value: mantRecordItems.value,
        sortOrder: mantRecordItems.sortOrder,
      }).from(mantRecordItems)
        .where(inArray(mantRecordItems.recordId, nativeIds))
        .orderBy(mantRecordItems.recordId, mantRecordItems.sortOrder)
      : Promise.resolve([]),
  ])

  const historicalWithItems = new Set(historicalItems.map((item) => item.checkSourceKey))
  const nativeWithItems = new Set(nativeItems.map((item) => item.recordId))
  const selectedHistorical = historicalCandidates.filter((check) => historicalWithItems.has(check.id.slice(2))).slice(0, limit)
  const selectedNative = nativeCandidates.filter((check) => nativeWithItems.has(check.id.slice(2))).slice(0, limit)
  const selected = [...selectedHistorical, ...selectedNative]
    .sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code, "es", { numeric: true }))
    .slice(0, limit)
  const selectedHistoricalKeys = selected.filter((check) => check.source === "historial").map((check) => check.id.slice(2))
  const selectedNativeIds = selected.filter((check) => check.source === "registro").map((check) => check.id.slice(2))

  const [historicalMeta, nativeMeta, photos] = await Promise.all([
    selectedHistoricalKeys.length
      ? db.select({
        sourceKey: mantHistoricalScheduleChecks.sourceKey,
        observations: HISTORICAL_OBSERVATIONS,
        filtersPhotoUrl: mantHistoricalScheduleChecks.filtersPhotoUrl,
        stickerPhotoUrl: mantHistoricalScheduleChecks.stickerPhotoUrl,
      }).from(mantHistoricalScheduleChecks).where(inArray(mantHistoricalScheduleChecks.sourceKey, selectedHistoricalKeys))
      : Promise.resolve([]),
    selectedNativeIds.length
      ? db.select({ id: mantRecords.id, notes: mantRecords.notes }).from(mantRecords).where(inArray(mantRecords.id, selectedNativeIds))
      : Promise.resolve([]),
    selectedNativeIds.length
      ? db.select({
        id: mantRecordPhotos.id,
        recordId: mantRecordPhotos.recordId,
        kind: mantRecordPhotos.kind,
        sortOrder: mantRecordPhotos.sortOrder,
        stampedAt: mantRecordPhotos.stampedAt,
        receivedAt: mantRecordPhotos.receivedAt,
      }).from(mantRecordPhotos)
        .where(and(inArray(mantRecordPhotos.recordId, selectedNativeIds), inArray(mantRecordPhotos.kind, ["filtros", "sticker"])))
        .orderBy(mantRecordPhotos.recordId, mantRecordPhotos.sortOrder)
      : Promise.resolve([]),
  ])

  const metaByKey = new Map<string, HistoricalMeta>(historicalMeta.map((row) => [row.sourceKey, row]))
  const nativeByKey = new Map<string, NativeMeta>(nativeMeta.map((row) => [row.id, row]))
  const photosByRecord = new Map<string, Array<{ id: string; kind: string; stampedAt: string; receivedAt: string }>>()
  for (const photo of photos) {
    if (!photo.recordId) continue
    const list = photosByRecord.get(photo.recordId) ?? []
    list.push({ id: photo.id, kind: photo.kind, stampedAt: photo.stampedAt, receivedAt: photo.receivedAt })
    photosByRecord.set(photo.recordId, list)
  }

  const itemsByHistorical = new Map<string, typeof historicalItems>()
  for (const item of historicalItems) {
    const list = itemsByHistorical.get(item.checkSourceKey) ?? []
    list.push(item)
    itemsByHistorical.set(item.checkSourceKey, list)
  }
  const itemsByNative = new Map<string, typeof nativeItems>()
  for (const item of nativeItems) {
    const list = itemsByNative.get(item.recordId) ?? []
    list.push(item)
    itemsByNative.set(item.recordId, list)
  }

  const matrixChecks: MatrixCheck[] = selected.map((check) => {
    const key = check.id.slice(2)
    const meta = check.source === "historial" ? metaByKey.get(key) : undefined
    const native = check.source === "registro" ? nativeByKey.get(key) : undefined
    const nativePhotos = check.source === "registro" ? photosByRecord.get(key) ?? [] : []
    const items: MatrixCheck["items"] = {}
    const itemOrder: Record<string, number> = {}
    const itemGroups: Record<string, string | null> = {}
    if (check.source === "historial") {
      for (const item of itemsByHistorical.get(key) ?? []) {
        items[item.itemName] = item.result === "realizado" ? "realizado" : item.result === "no_realizado" ? "no_realizado" : "no_aplica"
        itemOrder[item.itemName] = item.sortOrder
        itemGroups[item.itemName] = null
      }
    } else {
      for (const item of itemsByNative.get(key) ?? []) {
        items[item.itemName] = item.value === "R" ? "realizado" : item.value === "NR" ? "no_realizado" : "no_aplica"
        itemOrder[item.itemName] = item.sortOrder
        itemGroups[item.itemName] = item.groupName
      }
    }
    // Texto libre de una celda de Excel: sólo viajan al cliente los enlaces https a Drive/Docs.
    const filtersUrl = driveLink(meta?.filtersPhotoUrl)
    const stickerUrl = driveLink(meta?.stickerPhotoUrl)
    const photoUrls = [
      filtersUrl ? { label: "Filtros usados", url: filtersUrl } : null,
      stickerUrl ? { label: "Sticker", url: stickerUrl } : null,
    ].filter((value): value is { label: string; url: string } => value !== null)
    return {
      id: check.id,
      source: check.source,
      date: check.date,
      label: `${check.code || check.plate} · ${check.level}`,
      code: check.code,
      plate: check.plate,
      worksiteName: check.worksiteName,
      level: check.level,
      mechanic: check.mechanic,
      photoIds: nativePhotos.map((photo) => ({
        id: photo.id,
        caption: photo.kind === "filtros" ? "Filtros usados" : "Sticker",
        stampedAt: photo.stampedAt,
        receivedAt: photo.receivedAt,
      })),
      photoUrls,
      observations: meta?.observations ?? native?.notes ?? null,
      items,
      itemOrder,
      itemGroups,
    }
  })

  return {
    checks: matrixChecks,
    items: matrixRows(matrixChecks),
    withoutDetail: candidates.filter((check) => check.source === "historial" && !historicalWithItems.has(check.id.slice(2))).length,
  }
}

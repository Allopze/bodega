import { and, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantEquipmentProfiles, mantHistoricalScheduleChecks, mantRecords, worksites,
} from "@/db/schema"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { FORMS_CUTOVER_DATE } from "@/lib/mantencion/forms-cutover"
import { recordVisibility, recordVisibilitySql, type MantViewer } from "../access"
import { unitFromMeter } from "../fleet"
import { effectiveMeterSql } from "../unit-sql"
import { queryFilters } from "./filters"
import { effectiveWorksiteIds, recordInEquipmentUnitSql } from "./resolve"
import { levelLabel, mechanicKeyOf, parseLevelValue, percentFromCounts } from "./preventive-summary"
import type { ComplianceCheck, CrossDimension, LookerFilters, QueryFilters, ResolvedCrossFilters } from "./types"

/**
 * Pestaña Preventivo. Histórico y nativo no se solapan: los formularios cuentan hasta el corte y
 * los registros firmados desde el corte (misma regla que «Trabajos de mantención»).
 *
 * Este módulo carga las pautas del período (una fila por pauta); la matriz de checklist, la ficha del equipo y el
 * resumen se arman sobre ellas. El detalle por ítem del histórico viene del bloque «Detalle por ítem» del
 * consolidado (`mant_historical_schedule_items`).
 */

export const HISTORICAL_DATE = sql<string>`coalesce(${mantHistoricalScheduleChecks.performedOn}, left(${mantHistoricalScheduleChecks.submittedAt}, 10))`
export const HISTORICAL_MECHANIC = sql<string | null>`coalesce(${mantHistoricalScheduleChecks.mechanic}, (select f->>'value' from jsonb_array_elements(${mantHistoricalScheduleChecks.fields}) f where upper(f->>'header') like '%MECANICO%' limit 1))`
export const HISTORICAL_OBSERVATIONS = sql<string | null>`coalesce(${mantHistoricalScheduleChecks.observations}, (select f->>'value' from jsonb_array_elements(${mantHistoricalScheduleChecks.fields}) f where upper(f->>'header') like '%OBSERVACIONES%' limit 1))`

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
  photosComplete: boolean
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
    photosComplete: row.photosComplete === true,
  }
}

/** Histórico: los dos enlaces de respaldo (filtros y sticker) traen texto. */
export const HISTORICAL_PHOTOS_COMPLETE = sql<boolean>`(coalesce(btrim(${mantHistoricalScheduleChecks.filtersPhotoUrl}), '') <> '' and coalesce(btrim(${mantHistoricalScheduleChecks.stickerPhotoUrl}), '') <> '')`

/** Nativo: el registro tiene su foto de filtros y su sticker. */
export const NATIVE_PHOTOS_COMPLETE = sql<boolean>`(exists (select 1 from mant_record_photos p where p.record_id = ${mantRecords.id} and p.kind = 'filtros') and exists (select 1 from mant_record_photos p where p.record_id = ${mantRecords.id} and p.kind = 'sticker'))`

/** Pautas del período con los filtros efectivos, históricas y nativas, de la más reciente a la más antigua. */
export async function loadComplianceChecks(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  ignore: readonly CrossDimension[] = [],
): Promise<ComplianceCheck[]> {
  return selectChecks(viewer, queryFilters(filters, cross, ignore), filters.from, filters.to)
}

/**
 * Todas las pautas de UN equipo en el período, sin filtros cruzados ni de unidad (la unidad ya es la del equipo).
 * Es la misma consulta, con el mismo alcance por faena y la misma visibilidad, que alimenta las tablas: la ficha
 * del equipo no ve ni una pauta que la tabla no vea.
 */
export function loadVehicleChecks(viewer: MantViewer, vehicleId: string, from: string, to: string): Promise<ComplianceCheck[]> {
  return selectChecks(viewer, {
    worksiteIds: [], equipmentIds: [vehicleId], frequencies: [], month: null, conductorKey: null, mechanicKey: null,
    workId: null, checkId: null, unit: null,
  }, from, to)
}

async function selectChecks(viewer: MantViewer, query: QueryFilters, from: string, to: string): Promise<ComplianceCheck[]> {
  const filters = { from, to }
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
    unit: effectiveMeterSql.as("unit"),
    photosComplete: HISTORICAL_PHOTOS_COMPLETE.as("photosComplete"),
  })
    .from(mantHistoricalScheduleChecks)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantHistoricalScheduleChecks.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .leftJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id))
    .leftJoin(worksites, eq(worksites.id, mantHistoricalScheduleChecks.worksiteId))
    .where(and(
      eq(mantHistoricalScheduleChecks.isTest, false),
      sql`${HISTORICAL_DATE} >= ${filters.from} AND ${HISTORICAL_DATE} <= ${filters.to}`,
      sql`${HISTORICAL_DATE} < ${FORMS_CUTOVER_DATE}`,
      worksiteScopeSqlFor(scope, mantHistoricalScheduleChecks.worksiteId),
      vehicleIds.length ? inArray(mantHistoricalScheduleChecks.vehicleId, vehicleIds) : undefined,
      meterType ? eq(effectiveMeterSql, meterType) : undefined,
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
    unit: effectiveMeterSql.as("unit"),
    photosComplete: NATIVE_PHOTOS_COMPLETE.as("photosComplete"),
  })
    .from(mantRecords)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantRecords.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .leftJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id))
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
      // Una pauta en la unidad anterior no se rotula con la actual: queda fuera de la unidad activa.
      recordInEquipmentUnitSql,
      meterType ? eq(effectiveMeterSql, meterType) : undefined,
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


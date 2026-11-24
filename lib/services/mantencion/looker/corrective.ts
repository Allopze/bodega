import { access } from "node:fs/promises"
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm"
import { unionAll } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantHistoricalRecords, mantRecordCorrectives, mantRecordPhotos, mantRecords, mantWorkOrders, worksites,
} from "@/db/schema"
import { resolveMantencionFile } from "@/lib/storage/config"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { FORMS_CUTOVER_DATE } from "@/lib/mantencion/forms-cutover"
import { nameKey } from "@/lib/mantencion/normalize"
import type { MantUnit } from "@/lib/mantencion/types"
import { recordVisibility, recordVisibilitySql, type MantViewer } from "../access"
import { unitFromMeter } from "../fleet"
import { workOrderVisibility, workOrderVisibilitySql } from "../work-orders/access"
import { queryFilters } from "./filters"
import { effectiveWorksiteIds } from "./resolve"
import type {
  CorrectivePage, CorrectiveSummary, CorrectiveWorkRow, CrossDimension, DriverRow, EquipmentSeriesRow,
  LookerFilters, ResolvedCrossFilters,
} from "./types"

/**
 * Pestaña Correctivo: trabajos de mantención correctiva de las tres fuentes del módulo, unificados
 * y paginados en SQL.
 *
 * - `historial`: formularios importados antes del corte (`action_type = correctiva`).
 * - `ot`: órdenes no anuladas que ya entraron a taller (una OT sin ingreso todavía no es trabajo).
 * - `registro`: correctivas firmadas en la plataforma sin OT, desde el corte.
 *
 * La pestaña Camiones filtra `unit = km` y Máquinas `unit = h`: el correctivo de máquinas no se
 * duplica con el de camiones. El alcance por faena y la visibilidad de OT/registros se aplican en
 * cada rama; los filtros de la barra se aplican además sobre la unión.
 */

const PAGE_SIZE = 25
/** Equipos que dibuja el gráfico de horas y registros. */
const SERIES_LIMIT = 8
const HISTORICAL_DATE = sql<string>`CASE WHEN ${mantHistoricalRecords.entryDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(${mantHistoricalRecords.entryDate}, 10) ELSE left(${mantHistoricalRecords.submittedAt}, 10) END`
const OT_DATE = sql<string>`to_char(${mantWorkOrders.workshopEntryAt} AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD')`
const DRIVER_FIELD = sql<string | null>`(select f->>'value' from jsonb_array_elements(${mantHistoricalRecords.fields}) f where upper(f->>'header') like '%CONDUCTOR%' limit 1)`

type UnionRow = {
  id: string
  source: string
  date: string
  vehicleId: string | null
  recordId: string | null
  code: string
  plate: string
  typeName: string | null
  unit: string | null
  reading: number | string | null
  readingText: string | null
  reference: string
  workPerformed: string
  worksiteId: string | null
  worksiteName: string | null
  hours: number | string | null
  photoId: string | null
  photoUrl: string | null
  driverText: string | null
}

function equipmentText(code: string | null, plate: string | null, fallback: string): string {
  const value = [code, plate].filter(Boolean).join(" · ")
  return value || fallback
}

function buildBranches(viewer: MantViewer, filters: LookerFilters, query: ReturnType<typeof queryFilters>) {
  const scope = effectiveWorksiteIds(viewer, query.worksiteIds)
  const vehicleIds = query.equipmentIds
  const unit = query.unit
  const meterType = unit === "km" ? "odometer" : unit === "h" ? "hour_meter" : null

  const historical = db.select({
    id: sql<string>`('h:' || ${mantHistoricalRecords.sourceKey})`.as("id"),
    source: sql<string>`'historial'`.as("source"),
    date: HISTORICAL_DATE.as("date"),
    vehicleId: sql<string | null>`${mantHistoricalRecords.vehicleId}`.as("vehicleId"),
    recordId: sql<string | null>`NULL::text`.as("recordId"),
    code: sql<string>`coalesce(${fuelVehicles.code}, ${mantHistoricalRecords.equipmentText}, '')`.as("code"),
    plate: sql<string>`coalesce(${fuelVehicles.plate}, '')`.as("plate"),
    typeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("typeName"),
    unit: sql<string | null>`${fuelEquipmentTypes.defaultMeterType}`.as("unit"),
    reading: sql<number | null>`NULL::numeric`.as("reading"),
    readingText: sql<string | null>`nullif(btrim(${mantHistoricalRecords.readingText}), '')`.as("readingText"),
    reference: sql<string>`coalesce(${mantHistoricalRecords.orderText}, '')`.as("reference"),
    workPerformed: sql<string>`coalesce(${mantHistoricalRecords.description}, '')`.as("workPerformed"),
    worksiteId: sql<string | null>`${mantHistoricalRecords.worksiteId}`.as("worksiteId"),
    worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
    hours: sql<number | null>`${mantHistoricalRecords.laborHours}`.as("hours"),
    photoId: sql<string | null>`NULL::text`.as("photoId"),
    photoUrl: sql<string | null>`NULL::text`.as("photoUrl"),
    driverText: DRIVER_FIELD.as("driverText"),
  })
    .from(mantHistoricalRecords)
    .leftJoin(fuelVehicles, eq(fuelVehicles.id, mantHistoricalRecords.vehicleId))
    .leftJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .leftJoin(worksites, eq(worksites.id, mantHistoricalRecords.worksiteId))
    .where(and(
      eq(mantHistoricalRecords.isTest, false),
      eq(mantHistoricalRecords.actionType, "correctiva"),
      sql`${HISTORICAL_DATE} >= ${filters.from} AND ${HISTORICAL_DATE} <= ${filters.to}`,
      sql`${HISTORICAL_DATE} < ${FORMS_CUTOVER_DATE}`,
      worksiteScopeSqlFor(scope, mantHistoricalRecords.worksiteId),
      vehicleIds.length ? inArray(mantHistoricalRecords.vehicleId, vehicleIds) : undefined,
      meterType ? eq(fuelEquipmentTypes.defaultMeterType, meterType) : undefined,
    ))

  const orders = db.select({
    id: sql<string>`('ot:' || ${mantWorkOrders.id})`.as("id"),
    source: sql<string>`'ot'`.as("source"),
    date: OT_DATE.as("date"),
    vehicleId: sql<string | null>`${mantWorkOrders.vehicleId}`.as("vehicleId"),
    recordId: sql<string | null>`(select r.id from mant_records r where r.work_order_id = ${mantWorkOrders.id} and r.status = 'vigente' order by r.work_date desc limit 1)`.as("recordId"),
    code: sql<string>`coalesce(${fuelVehicles.code}, '')`.as("code"),
    plate: sql<string>`coalesce(${fuelVehicles.plate}, '')`.as("plate"),
    typeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("typeName"),
    unit: sql<string | null>`${fuelEquipmentTypes.defaultMeterType}`.as("unit"),
    reading: sql<number | null>`case when ${fuelEquipmentTypes.defaultMeterType} = 'odometer' then ${mantWorkOrders.entryOdometer} else ${mantWorkOrders.entryHourmeter} end`.as("reading"),
    readingText: sql<string | null>`NULL::text`.as("readingText"),
    reference: sql<string>`${mantWorkOrders.folio}`.as("reference"),
    workPerformed: sql<string>`coalesce(${mantWorkOrders.workPerformed}, ${mantWorkOrders.repairDescription}, ${mantWorkOrders.observations}, '')`.as("workPerformed"),
    worksiteId: sql<string | null>`${mantWorkOrders.worksiteId}`.as("worksiteId"),
    worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
    // La OT no siempre trae horas propias: si el registro correctivo enlazado las trae, se usan.
    hours: sql<number | null>`coalesce(${mantWorkOrders.laborHours}, (select c.hours from mant_record_correctives c join mant_records r on r.id = c.record_id where r.work_order_id = ${mantWorkOrders.id} and r.status = 'vigente' order by r.work_date desc limit 1))`.as("hours"),
    photoId: sql<string | null>`(select p.id from mant_record_photos p join mant_records r on r.id = p.record_id where r.work_order_id = ${mantWorkOrders.id} and p.kind = 'correctiva' order by p.sort_order limit 1)`.as("photoId"),
    photoUrl: sql<string | null>`NULL::text`.as("photoUrl"),
    driverText: sql<string | null>`(select string_agg(d.driver_name, ', ') from mant_record_drivers d join mant_records r on r.id = d.record_id where r.work_order_id = ${mantWorkOrders.id})`.as("driverText"),
  })
    .from(mantWorkOrders)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantWorkOrders.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, mantWorkOrders.worksiteId))
    .where(and(
      ne(mantWorkOrders.status, "anulada"),
      isNotNull(mantWorkOrders.workshopEntryAt),
      or(eq(mantWorkOrders.actionType, "correctiva"), and(isNull(mantWorkOrders.actionType), eq(mantWorkOrders.repair, true))),
      sql`${OT_DATE} >= ${filters.from} AND ${OT_DATE} <= ${filters.to}`,
      workOrderVisibilitySql(workOrderVisibility(viewer)),
      worksiteScopeSqlFor(scope, mantWorkOrders.worksiteId),
      vehicleIds.length ? inArray(mantWorkOrders.vehicleId, vehicleIds) : undefined,
      meterType ? eq(fuelEquipmentTypes.defaultMeterType, meterType) : undefined,
    ))

  const records = db.select({
    id: sql<string>`('r:' || ${mantRecords.id})`.as("id"),
    source: sql<string>`'registro'`.as("source"),
    date: sql<string>`${mantRecords.workDate}`.as("date"),
    vehicleId: sql<string | null>`${mantRecords.vehicleId}`.as("vehicleId"),
    recordId: sql<string | null>`${mantRecords.id}`.as("recordId"),
    code: sql<string>`coalesce(${fuelVehicles.code}, '')`.as("code"),
    plate: sql<string>`coalesce(${fuelVehicles.plate}, '')`.as("plate"),
    typeName: sql<string | null>`${fuelEquipmentTypes.name}`.as("typeName"),
    unit: sql<string | null>`${fuelEquipmentTypes.defaultMeterType}`.as("unit"),
    reading: sql<number | null>`${mantRecords.reading}`.as("reading"),
    readingText: sql<string | null>`NULL::text`.as("readingText"),
    reference: sql<string>`coalesce(${mantRecords.folio}, '')`.as("reference"),
    workPerformed: sql<string>`coalesce(${mantRecordCorrectives.description}, '')`.as("workPerformed"),
    worksiteId: sql<string | null>`${mantRecords.worksiteId}`.as("worksiteId"),
    worksiteName: sql<string | null>`${worksites.name}`.as("worksiteName"),
    hours: sql<number | null>`${mantRecordCorrectives.hours}`.as("hours"),
    photoId: sql<string | null>`(select p.id from mant_record_photos p where p.record_id = ${mantRecords.id} and p.kind = 'correctiva' order by p.sort_order limit 1)`.as("photoId"),
    photoUrl: sql<string | null>`NULL::text`.as("photoUrl"),
    driverText: sql<string | null>`(select string_agg(d.driver_name, ', ') from mant_record_drivers d where d.record_id = ${mantRecords.id})`.as("driverText"),
  })
    .from(mantRecords)
    .innerJoin(mantRecordCorrectives, eq(mantRecordCorrectives.recordId, mantRecords.id))
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantRecords.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, mantRecords.worksiteId))
    .where(and(
      eq(mantRecords.kind, "C"),
      eq(mantRecords.status, "vigente"),
      isNull(mantRecords.workOrderId),
      gte(mantRecords.workDate, FORMS_CUTOVER_DATE),
      gte(mantRecords.workDate, filters.from),
      lte(mantRecords.workDate, filters.to),
      recordVisibilitySql(recordVisibility(viewer)),
      worksiteScopeSqlFor(scope, mantRecords.worksiteId),
      vehicleIds.length ? inArray(mantRecords.vehicleId, vehicleIds) : undefined,
      meterType ? eq(fuelEquipmentTypes.defaultMeterType, meterType) : undefined,
    ))

  return { historical, orders, records, scope, meterType }
}

/** Une las tres ramas y aplica los filtros que son iguales en todas. */
function buildUnion(viewer: MantViewer, filters: LookerFilters, query: ReturnType<typeof queryFilters>) {
  const { historical, orders, records, scope, meterType } = buildBranches(viewer, filters, query)
  const union = unionAll(historical, orders, records).as("corrective_work")
  const conditions = [
    scope === "all" ? undefined : inArray(union.worksiteId, scope as string[]),
    query.equipmentIds.length ? inArray(union.vehicleId, query.equipmentIds) : undefined,
    meterType ? eq(union.unit, meterType) : undefined,
    query.workId ? eq(union.id, query.workId) : undefined,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined)
  return { union, where: and(...conditions), empty: scope !== "all" && scope.length === 0 }
}

function toWorkRow(row: UnionRow): CorrectiveWorkRow {
  return {
    id: row.id,
    source: row.source === "ot" ? "ot" : row.source === "registro" ? "registro" : "historial",
    date: row.date,
    vehicleId: row.vehicleId,
    recordId: row.recordId,
    code: row.code,
    plate: row.plate,
    typeName: row.typeName ?? "",
    unit: unitFromMeter(row.unit ?? "") as MantUnit | null,
    reading: row.reading == null ? null : Number(row.reading),
    readingText: row.readingText,
    reference: row.reference,
    workPerformed: row.workPerformed,
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    hours: row.hours == null ? null : Number(row.hours),
    photoId: row.photoId,
    photoUrl: row.photoUrl,
  }
}

export interface CorrectiveSummaryOptions {
  ignore?: readonly CrossDimension[]
  /** El gráfico sí se filtra por conductor; la tabla de conductores no. */
  applyConductor?: boolean
  conductorWorkIds?: string[]
  /** Equipos de la serie (por horas): los 8 que dibuja el gráfico; la exportación pide todos. */
  seriesLimit?: number
}

/**
 * La unión de trabajos correctivos con los filtros de la tabla de OT: la OT elegida no la acota (la tabla no se
 * filtra a sí misma) y el conductor elegido sí (`conductorWorkIds`). `null` = no hay nada que consultar. La
 * comparten la página de la tabla y la exportación a Excel, para que den siempre las mismas filas.
 */
function correctiveTableFilter(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  conductorWorkIds: string[] | undefined,
) {
  const query = queryFilters(filters, cross, ["work"])
  const { union, where, empty } = buildUnion(viewer, filters, query)
  if (empty || (conductorWorkIds && conductorWorkIds.length === 0)) return null
  const conductor = conductorWorkIds ? inArray(union.id, conductorWorkIds) : undefined
  return { union, filtered: conductor ? and(where, conductor) : where }
}

/**
 * TODAS las filas de la tabla de trabajos correctivos con los mismos filtros que `loadCorrectivePage`, sin
 * paginar: es lo que exporta el Excel. Trae hasta `limit` filas (las más recientes primero) y el total, para
 * que quien exporta pueda decir cuándo cortó. No consulta las fotos: el libro no las lleva.
 */
export async function loadCorrectiveRows(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  options: { conductorWorkIds?: string[]; limit: number },
): Promise<{ rows: CorrectiveWorkRow[]; total: number }> {
  const table = correctiveTableFilter(viewer, filters, cross, options.conductorWorkIds)
  if (!table) return { rows: [], total: 0 }
  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(table.union).where(table.filtered)
  const rawRows = await db.select().from(table.union).where(table.filtered)
    .orderBy(desc(table.union.date), desc(table.union.id))
    .limit(options.limit)
  return { rows: rawRows.map((row) => toWorkRow(row as UnionRow)), total: Number(countRow?.n ?? 0) }
}

/** Página de la tabla de trabajos correctivos. */
export async function loadCorrectivePage(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  options: { conductorWorkIds?: string[] } = {},
): Promise<CorrectivePage> {
  const table = correctiveTableFilter(viewer, filters, cross, options.conductorWorkIds)
  if (!table) return { rows: [], total: 0, page: 1, pageSize: PAGE_SIZE }
  const { union, filtered } = table
  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(union).where(filtered)
  const total = Number(countRow?.n ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(Math.max(1, filters.page), totalPages)
  const rawRows = await db.select().from(union).where(filtered)
    .orderBy(desc(union.date), desc(union.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
  // Una foto puede tener fila y no archivo (storage incompleto o borrado): se comprueba la
  // existencia antes de pintar la miniatura, si no el navegador pide una imagen que da 404.
  const photoIds = [...new Set(rawRows.map((row) => row.photoId).filter((id): id is string => !!id))]
  const availablePhotos = new Set<string>()
  if (photoIds.length > 0) {
    const photos = await db.select({ id: mantRecordPhotos.id, storageKey: mantRecordPhotos.storageKey })
      .from(mantRecordPhotos)
      .where(inArray(mantRecordPhotos.id, photoIds))
    await Promise.all(photos.map(async (photo) => {
      const absolute = resolveMantencionFile(photo.storageKey)
      if (!absolute) return
      try {
        await access(absolute)
        availablePhotos.add(photo.id)
      } catch {
        // El archivo no está: la fila conserva su «Sin foto».
      }
    }))
  }
  const rows = rawRows.map((row) => ({
    ...row,
    photoId: row.photoId && availablePhotos.has(row.photoId) ? row.photoId : null,
  }))
  return { rows: rows.map((row) => toWorkRow(row as UnionRow)), total, page, pageSize: PAGE_SIZE }
}

export function parseDrivers(driverText: string | null): string[] {
  if (!driverText) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const part of driverText.split(/[,;/]/)) {
    const name = part.trim()
    if (name.length < 3) continue
    const key = nameKey(name)
    if (["NOAPLICA", "SINCONDUCTOR", "NOSEINFORMA", "NA"].includes(key.toUpperCase())) continue
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

/**
 * Conductores del período y serie por equipo. No aplica el filtro de conductor: la tabla de
 * conductores no se filtra a sí misma y necesita la lista completa para resaltar el elegido.
 * El gráfico sí lo aplica, con `applyConductor` y los ids que devuelve esta misma función.
 */
export async function loadCorrectiveSummary(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  options: CorrectiveSummaryOptions = {},
): Promise<CorrectiveSummary> {
  // El resumen de conductores SÍ aplica la OT elegida (una OT filtra sus conductores);
  // la tabla de OT es la que ignora esa dimensión para no filtrarse a sí misma.
  const query = queryFilters(filters, cross, options.ignore ?? [])
  const { union, where, empty } = buildUnion(viewer, filters, query)
  if (empty) return { drivers: [], series: [], selectedDriver: null }
  const conductor = options.applyConductor && options.conductorWorkIds
    ? options.conductorWorkIds.length ? inArray(union.id, options.conductorWorkIds) : sql`false`
    : undefined
  const rows = await db.select().from(union).where(conductor ? and(where, conductor) : where)

  const drivers = new Map<string, { label: string; records: number; hours: number; workIds: Set<string> }>()
  const series = new Map<string, { label: string; records: number; hours: number }>()
  for (const row of rows) {
    const workId = row.id
    const names = parseDrivers(row.driverText)
    const hours = row.hours == null ? 0 : Number(row.hours)
    for (const name of names) {
      const key = nameKey(name)
      const driver = drivers.get(key) ?? { label: name, records: 0, hours: 0, workIds: new Set<string>() }
      driver.records += 1
      driver.hours += names.length > 0 ? hours / names.length : 0
      driver.workIds.add(workId)
      drivers.set(key, driver)
    }
    if (row.vehicleId) {
      const item = series.get(row.vehicleId) ?? { label: equipmentText(row.code, row.plate, "Equipo"), records: 0, hours: 0 }
      item.records += 1
      item.hours += hours
      series.set(row.vehicleId, item)
    }
  }

  const driverRows: DriverRow[] = [...drivers.entries()].map(([key, value]) => ({
    key,
    label: value.label,
    records: value.records,
    hours: Math.round(value.hours * 10) / 10,
    workIds: [...value.workIds],
  })).sort((a, b) => b.hours - a.hours || b.records - a.records || a.label.localeCompare(b.label, "es"))

  const seriesRows: EquipmentSeriesRow[] = [...series.entries()].map(([vehicleId, value]) => ({
    vehicleId,
    label: value.label,
    records: value.records,
    hours: Math.round(value.hours * 10) / 10,
  })).sort((a, b) => b.hours - a.hours || b.records - a.records || a.label.localeCompare(b.label, "es"))
    .slice(0, options.seriesLimit ?? SERIES_LIMIT)

  const selectedKey = cross.conductor?.key
  return {
    drivers: driverRows,
    series: seriesRows,
    selectedDriver: selectedKey ? driverRows.find((driver) => driver.key === selectedKey) ?? null : null,
  }
}

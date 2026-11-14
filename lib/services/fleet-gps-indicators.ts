import type { Session } from "next-auth"
import { and, desc, eq, gte, inArray, isNotNull, lt, ne, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetGpsAlerts,
  fleetGpsDeviceLinks,
  fleetGpsLatestPositions,
  fleetGpsTrips,
  fuelAnomalyRules,
  fuelEquipmentTypes,
  fuelMeterReadings,
  fuelTelemetryDaily,
  fuelVehicles,
  worksites,
} from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { maxMeterRatePerDayOf, meterSeriesSegments, type MeterSeriesPoint } from "@/lib/combustibles/meter-series"
import { getIdleFleetMonths, listIdleVehicles } from "@/lib/combustibles/control/queries/idle"
import type { ControlFilters } from "@/lib/combustibles/control/filters"
import { bucketKey, listBuckets, rangeLengthDays, type DateRange, type IndicatorGranularity } from "@/lib/indicators/period"
import { addDaysToPlainDate, chileDayStartInstant, todayInChile } from "@/lib/utils"
import {
  classifyGpsAlert,
  isCountedGpsAlertClass,
  type CountedGpsAlertClass,
} from "./fleet-gps-alert-class"

/**
 * Indicadores GPS de Control operacional (`/flota/indicadores`): uso de la flota
 * (km y horas de motor), ralentí y conducción.
 *
 * Fuentes, y por qué cada una:
 * - `fuel_meter_readings` con las tres fuentes GPS (`gps_onway`, `gps_wialon`,
 *   `visionlink_api`), nunca `copec_tct`: el avance de odómetro y horómetro.
 * - `fuel_telemetry_daily` (VisionLink): horas de trabajo y de ralentí. Se lee con
 *   `getIdleFleetMonths`, la misma consulta de «Motor en vacío», para que las dos
 *   pantallas no discrepen.
 * - `fleet_gps_trips` y `fleet_gps_alerts` (sólo OnWay): viajes y alertas. Las
 *   columnas de duración de los viajes no se usan: su formato no es uniforme
 *   (`PT5H` en unos, `00:10:00` en otros).
 *
 * Todas las consultas se acotan por faena con `worksiteScopeSql`; una faena fuera
 * del alcance del rol devuelve cero filas, no las de esa faena.
 */

// ── Fuentes de medidor ───────────────────────────────────────────────────────

export type GpsMeterSource = "visionlink_api" | "gps_wialon" | "gps_onway"
export type GpsMeterType = "odometer" | "hour_meter"

export const GPS_METER_SOURCES: readonly GpsMeterSource[] = ["visionlink_api", "gps_wialon", "gps_onway"]

/**
 * Orden de preferencia por medidor. Es el de `computeGpsAdvance` en
 * `operational-control.ts`: el horómetro oficial de Cat (VisionLink) primero, y
 * para el odómetro Wialon antes que OnWay.
 */
const SOURCE_PRIORITY: Record<GpsMeterType, readonly GpsMeterSource[]> = {
  hour_meter: ["visionlink_api", "gps_wialon", "gps_onway"],
  odometer: ["gps_wialon", "gps_onway"],
}

/**
 * Elige UNA fuente por equipo y medidor: nunca se encadenan puntos de
 * proveedores distintos, porque son medidores y calibraciones distintas
 * (misma regla que el Panel operacional).
 *
 * Una adaptación respecto del Panel: allá se exige que la fuente cubra el
 * período completo, porque el avance divide un gasto de ese período. Aquí se
 * grafica actividad dentro de una ventana, así que no se exige cobertura total;
 * en cambio una fuente con apenas un puñado de lecturas no desplaza a otra con
 * historia: gana la de mayor prioridad cuyo número de lecturas diarias llegue a
 * la mitad de la mejor.
 */
export function pickGpsMeterSource(
  meterType: GpsMeterType,
  readingDays: Partial<Record<GpsMeterSource, number>>,
): GpsMeterSource | null {
  const candidates = SOURCE_PRIORITY[meterType].filter((source) => (readingDays[source] ?? 0) >= 2)
  if (candidates.length === 0) return null
  const best = Math.max(...candidates.map((source) => readingDays[source] ?? 0))
  return candidates.find((source) => (readingDays[source] ?? 0) >= best / 2) ?? candidates[0]!
}

/**
 * Avance atribuido a cada día: el de los pares consecutivos que ningún control
 * objeta (`meterSeriesSegments`: sin retrocesos ni saltos imposibles, con la cota
 * `maxPerDay`), asignado al día de la lectura que cierra el par. La serie trae una
 * lectura por día chileno.
 */
export function dailyAdvanceFromSeries(
  points: readonly MeterSeriesPoint[],
  maxPerDay: number,
): Array<{ day: string; advance: number }> {
  const out: Array<{ day: string; advance: number }> = []
  for (const segment of meterSeriesSegments(points, maxPerDay)) {
    if (segment.status !== "counted" || segment.advance <= 0) continue
    out.push({ day: todayInChile(segment.to.occurredAt), advance: segment.advance })
  }
  return out
}

// ── Semanas ──────────────────────────────────────────────────────────────────

/** Lunes de la semana de una fecha civil «YYYY-MM-DD». */
export function weekStart(plainDate: string): string {
  const dow = new Date(Date.parse(`${plainDate}T00:00:00Z`)).getUTCDay() // 0 = domingo
  return addDaysToPlainDate(plainDate, -((dow + 6) % 7))
}

/** Semanas del rango (por su lunes), incluidas las vacías. */
export function listWeeks(from: string, to: string): string[] {
  const keys: string[] = []
  for (let week = weekStart(from); week <= to; week = addDaysToPlainDate(week, 7)) keys.push(week)
  return keys
}

export type AlertGranularity = "week" | "month"

/** Hasta ~6 meses las alertas se leen por semana; sobre eso, por mes (más de 27 columnas apiladas no se leen). */
export const ALERT_WEEK_MAX_DAYS = 190

export function alertGranularity(from: string, to: string): AlertGranularity {
  return rangeLengthDays(from, to) <= ALERT_WEEK_MAX_DAYS ? "week" : "month"
}

export function alertBucketKey(plainDate: string, granularity: AlertGranularity): string {
  return granularity === "week" ? weekStart(plainDate) : plainDate.slice(0, 7)
}

export function listAlertBuckets(from: string, to: string, granularity: AlertGranularity): string[] {
  return granularity === "week" ? listWeeks(from, to) : listBuckets(from, to, "month")
}

// ── Entrada común ────────────────────────────────────────────────────────────

export interface GpsIndicatorsInput {
  from: string
  to: string
  previous: DateRange
  granularity: IndicatorGranularity
  /** Faena elegida; el alcance del rol manda sobre ella. */
  worksiteId?: string
}

/** Rango [from, to] de la consulta como instantes: inicio del primer día y del día siguiente al último. */
function instantRange(from: string, to: string): { start: string; end: string } {
  return { start: chileDayStartInstant(from), end: chileDayStartInstant(addDaysToPlainDate(to, 1)) }
}

const chileDay = (column: SQL | AnyColumn) =>
  sql<string>`to_char((${column} at time zone 'America/Santiago'), 'YYYY-MM-DD')`

/** Equipos del alcance que cuentan como flota: los que no están dados de baja (igual que `gpsCross.totalVehicles` del Panel). */
function vehicleScope(session: Session, worksiteId?: string): SQL | undefined {
  return and(
    worksiteScopeSql(session, fuelVehicles.worksiteId, worksiteId),
    ne(fuelVehicles.operationalStatus, "inactivo"),
  )
}

// ── Uso de la flota ──────────────────────────────────────────────────────────

export interface GpsVehicleUsage {
  vehicleId: string
  code: string | null
  plate: string
  typeName: string
  worksiteId: string
  worksiteName: string
  km: number
  hours: number
}

export interface GpsWorksiteUsage {
  worksiteId: string
  name: string
  km: number
  hours: number
  vehicles: number
}

export interface GpsUsageBucket {
  key: string
  km: number
  hours: number
}

export interface GpsUsageIndicators {
  /** Equipos de la flota en el alcance (no dados de baja). */
  fleetVehicles: number
  /** Los que tienen GPS o telemetría vinculados: dispositivo, posición, lecturas de medidor o telemetría VisionLink. */
  linkedVehicles: number
  /** Vinculados con alguna lectura de medidor en el período. */
  vehiclesWithReadings: number
  /** Con avance de km u horas en el período. */
  vehiclesWithUse: number
  km: { current: number; previous: number }
  hours: { current: number; previous: number }
  buckets: GpsUsageBucket[]
  byWorksite: GpsWorksiteUsage[]
  /** Con más km primero; sólo los que recorrieron algo. */
  topByKm: GpsVehicleUsage[]
  /** Con más horas primero; sólo los que registraron horas. */
  topByHours: GpsVehicleUsage[]
}

export interface GpsUsageVehicleRow {
  id: string
  code: string | null
  plate: string
  typeName: string
  typeSlug: string
  worksiteId: string
  worksiteName: string
}

export interface GpsMeterReadingRow {
  vehicleId: string | null
  source: string
  meterType: string
  occurredAt: string
  value: number | string
}

const TOP_VEHICLES = 8

/** Lo que la agregación necesita, sin acceso a datos (la prueba pura la alimenta a mano). */
export function buildGpsUsage(input: {
  vehicles: readonly GpsUsageVehicleRow[]
  meterRows: readonly GpsMeterReadingRow[]
  /** Equipos con GPS/telemetría vinculados además de los que traen lecturas. */
  linkedExtra: ReadonlySet<string>
  rule: { config: string | null }
  period: GpsIndicatorsInput
}): GpsUsageIndicators {
  const { vehicles, meterRows, linkedExtra, rule, period } = input
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))

  // Series por equipo, fuente y medidor (ya llegan ordenadas por día).
  const series = new Map<string, MeterSeriesPoint[]>()
  const readingVehicles = new Set<string>()
  const anyReadingVehicles = new Set<string>()
  for (const row of meterRows) {
    if (!row.vehicleId || !vehicleById.has(row.vehicleId)) continue
    anyReadingVehicles.add(row.vehicleId)
    const key = `${row.vehicleId}|${row.meterType}|${row.source}`
    const list = series.get(key) ?? []
    list.push({ value: Number(row.value), occurredAt: row.occurredAt })
    series.set(key, list)
    const day = todayInChile(row.occurredAt)
    if (day >= period.from && day <= period.to) readingVehicles.add(row.vehicleId)
  }

  const bucketKeys = listBuckets(period.from, period.to, period.granularity)
  const buckets = new Map(bucketKeys.map((key) => [key, { key, km: 0, hours: 0 }]))
  const perVehicle = new Map<string, { km: number; hours: number }>()
  const km = { current: 0, previous: 0 }
  const hours = { current: 0, previous: 0 }

  for (const vehicle of vehicles) {
    for (const meterType of ["odometer", "hour_meter"] as const) {
      const counts: Partial<Record<GpsMeterSource, number>> = {}
      for (const source of GPS_METER_SOURCES) {
        const points = series.get(`${vehicle.id}|${meterType}|${source}`)
        if (points) counts[source] = points.length
      }
      const source = pickGpsMeterSource(meterType, counts)
      if (!source) continue
      const points = series.get(`${vehicle.id}|${meterType}|${source}`) ?? []
      const maxPerDay = maxMeterRatePerDayOf(rule, meterType === "odometer" ? "km" : "hora", vehicle.typeSlug || undefined)
      const total = meterType === "odometer" ? km : hours
      for (const { day, advance } of dailyAdvanceFromSeries(points, maxPerDay)) {
        if (day >= period.from && day <= period.to) {
          total.current += advance
          const bucket = buckets.get(bucketKey(day, period.granularity))
          if (bucket) bucket[meterType === "odometer" ? "km" : "hours"] += advance
          const acc = perVehicle.get(vehicle.id) ?? { km: 0, hours: 0 }
          acc[meterType === "odometer" ? "km" : "hours"] += advance
          perVehicle.set(vehicle.id, acc)
        } else if (day >= period.previous.from && day <= period.previous.to) {
          total.previous += advance
        }
      }
    }
  }

  const usageRows: GpsVehicleUsage[] = [...perVehicle.entries()].flatMap(([vehicleId, used]) => {
    const vehicle = vehicleById.get(vehicleId)
    if (!vehicle || (used.km <= 0 && used.hours <= 0)) return []
    return [{
      vehicleId,
      code: vehicle.code,
      plate: vehicle.plate,
      typeName: vehicle.typeName,
      worksiteId: vehicle.worksiteId,
      worksiteName: vehicle.worksiteName,
      km: used.km,
      hours: used.hours,
    }]
  })

  const byWorksiteMap = new Map<string, GpsWorksiteUsage>()
  for (const row of usageRows) {
    const acc = byWorksiteMap.get(row.worksiteId) ?? { worksiteId: row.worksiteId, name: row.worksiteName, km: 0, hours: 0, vehicles: 0 }
    acc.km += row.km
    acc.hours += row.hours
    acc.vehicles += 1
    byWorksiteMap.set(row.worksiteId, acc)
  }

  const byCode = (a: GpsVehicleUsage, b: GpsVehicleUsage) => (a.code ?? a.plate).localeCompare(b.code ?? b.plate, "es")
  const linked = new Set<string>([...linkedExtra, ...anyReadingVehicles].filter((id) => vehicleById.has(id)))
  return {
    fleetVehicles: vehicles.length,
    linkedVehicles: linked.size,
    vehiclesWithReadings: [...readingVehicles].filter((id) => linked.has(id)).length,
    vehiclesWithUse: usageRows.length,
    km,
    hours,
    buckets: bucketKeys.map((key) => buckets.get(key)!),
    byWorksite: [...byWorksiteMap.values()].sort((a, b) => b.km - a.km || b.hours - a.hours || a.name.localeCompare(b.name, "es")),
    topByKm: usageRows.filter((row) => row.km > 0).sort((a, b) => b.km - a.km || byCode(a, b)).slice(0, TOP_VEHICLES),
    topByHours: usageRows.filter((row) => row.hours > 0).sort((a, b) => b.hours - a.hours || byCode(a, b)).slice(0, TOP_VEHICLES),
  }
}

/** «Uso de la flota»: km y horas de motor por balde, faena y equipo, con el período anterior para la variación. */
export async function getGpsUsageIndicators(session: Session, input: GpsIndicatorsInput): Promise<GpsUsageIndicators> {
  if (!can(session, "flota:view")) throw new Error("Sin permisos para ver los indicadores GPS")
  const scope = vehicleScope(session, input.worksiteId)

  const vehicleRows = await db
    .select({
      id: fuelVehicles.id,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      typeName: fuelEquipmentTypes.name,
      typeSlug: fuelEquipmentTypes.slug,
      worksiteId: fuelVehicles.worksiteId,
      worksiteName: worksites.name,
    })
    .from(fuelVehicles)
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(scope)
    .orderBy(fuelVehicles.plate)

  if (vehicleRows.length === 0) return buildGpsUsage({ vehicles: [], meterRows: [], linkedExtra: new Set(), rule: { config: null }, period: input })
  const vehicleIds = vehicleRows.map((vehicle) => vehicle.id)

  // Una lectura por equipo, fuente, medidor y día chileno (la última del día), igual
  // que el Panel. Se parte un día antes del período anterior: el par que abre el
  // primer día necesita su lectura previa.
  const { start, end } = instantRange(addDaysToPlainDate(input.previous.from, -1), input.to)
  const dayExpr = chileDay(sql`${fuelMeterReadings.occurredAt}::timestamptz`)
  const [meterRows, ruleRows, positionRows, linkRows, telemetryRows] = await Promise.all([
    db.selectDistinctOn(
      [fuelMeterReadings.vehicleId, fuelMeterReadings.source, fuelMeterReadings.meterType, dayExpr],
      {
        vehicleId: fuelMeterReadings.vehicleId,
        source: fuelMeterReadings.source,
        meterType: fuelMeterReadings.meterType,
        occurredAt: fuelMeterReadings.occurredAt,
        value: fuelMeterReadings.value,
      },
    )
      .from(fuelMeterReadings)
      .where(and(
        inArray(fuelMeterReadings.source, [...GPS_METER_SOURCES]),
        inArray(fuelMeterReadings.vehicleId, vehicleIds),
        gte(fuelMeterReadings.occurredAt, start),
        lt(fuelMeterReadings.occurredAt, end),
      ))
      .orderBy(
        fuelMeterReadings.vehicleId,
        fuelMeterReadings.source,
        fuelMeterReadings.meterType,
        dayExpr,
        desc(fuelMeterReadings.occurredAt),
      ),
    db.select({ config: fuelAnomalyRules.config }).from(fuelAnomalyRules).where(eq(fuelAnomalyRules.code, "salto_medidor_implausible")).limit(1),
    db.selectDistinct({ vehicleId: fleetGpsLatestPositions.vehicleId }).from(fleetGpsLatestPositions).where(inArray(fleetGpsLatestPositions.vehicleId, vehicleIds)),
    db.selectDistinct({ vehicleId: fleetGpsDeviceLinks.vehicleId }).from(fleetGpsDeviceLinks)
      .where(and(eq(fleetGpsDeviceLinks.status, "linked"), inArray(fleetGpsDeviceLinks.vehicleId, vehicleIds))),
    db.selectDistinct({ vehicleId: fuelTelemetryDaily.vehicleId }).from(fuelTelemetryDaily).where(inArray(fuelTelemetryDaily.vehicleId, vehicleIds)),
  ])

  const linkedExtra = new Set<string>()
  for (const row of [...positionRows, ...linkRows, ...telemetryRows]) if (row.vehicleId) linkedExtra.add(row.vehicleId)

  return buildGpsUsage({
    vehicles: vehicleRows,
    meterRows,
    linkedExtra,
    rule: { config: ruleRows[0]?.config ?? null },
    period: input,
  })
}

// ── Ralentí (VisionLink) ─────────────────────────────────────────────────────

export interface GpsIdleMonth {
  /** «YYYY-MM». */
  key: string
  workingHours: number
  idleHours: number
}

export interface GpsIdleIndicators {
  /** Un elemento por mes del período con telemetría; los meses sin ella no aparecen (un hueco, no un cero). */
  months: GpsIdleMonth[]
  /** Equipos con telemetría VisionLink en el período. */
  vehicles: number
  /** Σ ralentí ÷ Σ funcionamiento, en %; `null` sin horas. */
  idlePct: number | null
  previousIdlePct: number | null
  workingHours: number
  idleHours: number
}

function controlFilters(range: DateRange, worksiteId?: string): ControlFilters {
  return { year: Number(range.from.slice(0, 4)), months: [], worksiteId, from: range.from, to: range.to, page: 1 }
}

function pctOf(idleHours: number, workingHours: number): number | null {
  const operating = idleHours + workingHours
  return operating > 0 ? (idleHours / operating) * 100 : null
}

/**
 * Horas de trabajo y de ralentí por mes. Las horas de funcionamiento incluyen el
 * ralentí (trabajo = funcionamiento − ralentí), como en «Motor en vacío»; por eso el
 * % es ralentí ÷ (trabajo + ralentí). Exige `combustibles:view`, el permiso de la
 * pantalla a la que remite.
 */
export async function getGpsIdleIndicators(session: Session, input: GpsIndicatorsInput): Promise<GpsIdleIndicators> {
  if (!can(session, "combustibles:view")) throw new Error("Sin permisos para ver el ralentí")
  const current = controlFilters({ from: input.from, to: input.to }, input.worksiteId)
  const [monthRows, previousRows, vehicles] = await Promise.all([
    getIdleFleetMonths(session, current),
    getIdleFleetMonths(session, controlFilters(input.previous, input.worksiteId)),
    listIdleVehicles(session, current),
  ])
  const months = monthRows.map((row) => ({ key: row.month, workingHours: row.workingHours, idleHours: row.idleHours }))
  const workingHours = months.reduce((sum, row) => sum + row.workingHours, 0)
  const idleHours = months.reduce((sum, row) => sum + row.idleHours, 0)
  return {
    months,
    vehicles: vehicles.length,
    idlePct: pctOf(idleHours, workingHours),
    previousIdlePct: pctOf(
      previousRows.reduce((sum, row) => sum + row.idleHours, 0),
      previousRows.reduce((sum, row) => sum + row.workingHours, 0),
    ),
    workingHours,
    idleHours,
  }
}

// ── Viajes y alertas (OnWay) ─────────────────────────────────────────────────

export interface GpsTripBucket {
  key: string
  trips: number
  km: number
}

export interface GpsAlertBucket {
  key: string
  counts: Record<CountedGpsAlertClass, number>
}

export interface GpsSpeedingVehicle {
  vehicleId: string
  code: string | null
  plate: string
  typeName: string
  count: number
}

export interface GpsDrivingIndicators {
  trips: { current: number; previous: number; km: number }
  tripBuckets: GpsTripBucket[]
  alertGranularity: AlertGranularity
  alertBuckets: GpsAlertBucket[]
  /** Total del período por clase (sin las operacionales). */
  alertTotals: Record<CountedGpsAlertClass, number>
  speeding: { current: number; previous: number }
  topSpeeding: GpsSpeedingVehicle[]
}

const emptyCounts = (): Record<CountedGpsAlertClass, number> => ({ speeding: 0, harsh_driving: 0, pothole: 0, idle: 0, other: 0 })

/** Agregación pura de las filas de alertas ya agrupadas por equipo, día y título. */
export function buildGpsAlertAggregates(input: {
  rows: ReadonlyArray<{ vehicleId: string | null; day: string; title: string; n: number }>
  vehicles: ReadonlyMap<string, { code: string | null; plate: string; typeName: string }>
  period: GpsIndicatorsInput
}): Pick<GpsDrivingIndicators, "alertGranularity" | "alertBuckets" | "alertTotals" | "speeding" | "topSpeeding"> {
  const { rows, vehicles, period } = input
  const granularity = alertGranularity(period.from, period.to)
  const keys = listAlertBuckets(period.from, period.to, granularity)
  const buckets = new Map<string, GpsAlertBucket>(keys.map((key) => [key, { key, counts: emptyCounts() }]))
  const totals = emptyCounts()
  const speeding = { current: 0, previous: 0 }
  const speedingByVehicle = new Map<string, number>()

  for (const row of rows) {
    const cls = classifyGpsAlert(row.title)
    if (!isCountedGpsAlertClass(cls)) continue
    const inCurrent = row.day >= period.from && row.day <= period.to
    const inPrevious = row.day >= period.previous.from && row.day <= period.previous.to
    if (cls === "speeding") {
      if (inCurrent) speeding.current += row.n
      else if (inPrevious) speeding.previous += row.n
    }
    if (!inCurrent) continue
    totals[cls] += row.n
    const bucket = buckets.get(alertBucketKey(row.day, granularity))
    if (bucket) bucket.counts[cls] += row.n
    if (cls === "speeding" && row.vehicleId) speedingByVehicle.set(row.vehicleId, (speedingByVehicle.get(row.vehicleId) ?? 0) + row.n)
  }

  const topSpeeding = [...speedingByVehicle.entries()].flatMap(([vehicleId, count]) => {
    const vehicle = vehicles.get(vehicleId)
    return vehicle ? [{ vehicleId, code: vehicle.code, plate: vehicle.plate, typeName: vehicle.typeName, count }] : []
  }).sort((a, b) => b.count - a.count || (a.code ?? a.plate).localeCompare(b.code ?? b.plate, "es")).slice(0, TOP_VEHICLES)

  return { alertGranularity: granularity, alertBuckets: keys.map((key) => buckets.get(key)!), alertTotals: totals, speeding, topSpeeding }
}

/**
 * Viajes por balde y alertas por semana o mes, con el período anterior para las
 * variaciones. Son historial de recorridos: exige `flota:view_gps_history`.
 */
export async function getGpsDrivingIndicators(session: Session, input: GpsIndicatorsInput): Promise<GpsDrivingIndicators> {
  if (!can(session, "flota:view") || !can(session, "flota:view_gps_history")) throw new Error("Sin permisos para ver el historial GPS")
  const scope = vehicleScope(session, input.worksiteId)
  const { start, end } = instantRange(input.previous.from, input.to)
  const tripDay = chileDay(fleetGpsTrips.startedAt)
  const alertDay = chileDay(fleetGpsAlerts.occurredAt)

  const [tripRows, alertRows] = await Promise.all([
    db.select({
      day: tripDay,
      n: sql<number>`count(*)::int`,
      km: sql<number>`coalesce(sum(${fleetGpsTrips.distanceKm}), 0)::float8`,
    })
      .from(fleetGpsTrips)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetGpsTrips.vehicleId))
      .where(and(scope, isNotNull(fleetGpsTrips.vehicleId), gte(fleetGpsTrips.startedAt, start), lt(fleetGpsTrips.startedAt, end)))
      .groupBy(tripDay),
    // El título nombra al dispositivo, así que se agrupa por equipo, día y título: las
    // alertas repetidas el mismo día se cuentan en la base y no una por una.
    db.select({
      vehicleId: fleetGpsAlerts.vehicleId,
      day: alertDay,
      title: fleetGpsAlerts.title,
      n: sql<number>`count(*)::int`,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      typeName: fuelEquipmentTypes.name,
    })
      .from(fleetGpsAlerts)
      .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetGpsAlerts.vehicleId))
      .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
      .where(and(scope, isNotNull(fleetGpsAlerts.vehicleId), gte(fleetGpsAlerts.occurredAt, start), lt(fleetGpsAlerts.occurredAt, end)))
      .groupBy(fleetGpsAlerts.vehicleId, alertDay, fleetGpsAlerts.title, fuelVehicles.code, fuelVehicles.plate, fuelEquipmentTypes.name),
  ])

  const tripKeys = listBuckets(input.from, input.to, input.granularity)
  const tripBuckets = new Map<string, GpsTripBucket>(tripKeys.map((key) => [key, { key, trips: 0, km: 0 }]))
  const trips = { current: 0, previous: 0, km: 0 }
  for (const row of tripRows) {
    if (row.day >= input.from && row.day <= input.to) {
      trips.current += row.n
      trips.km += row.km
      const bucket = tripBuckets.get(bucketKey(row.day, input.granularity))
      if (bucket) { bucket.trips += row.n; bucket.km += row.km }
    } else if (row.day >= input.previous.from && row.day <= input.previous.to) {
      trips.previous += row.n
    }
  }

  const vehicles = new Map(alertRows.flatMap((row) => row.vehicleId ? [[row.vehicleId, { code: row.code, plate: row.plate, typeName: row.typeName }] as const] : []))
  return {
    trips,
    tripBuckets: tripKeys.map((key) => tripBuckets.get(key)!),
    ...buildGpsAlertAggregates({ rows: alertRows, vehicles, period: input }),
  }
}

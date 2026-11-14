import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicleOperationalIntervals, fuelVehicles, mantWorkOrders } from "@/db/schema"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import { bucketKey, isPartialBucket, listBuckets, type DateRange, type IndicatorGranularity } from "@/lib/indicators/period"
import { MANT_EQUIPMENT_STATES, type MantEquipmentState } from "@/lib/mantencion/types"
import { OT_OPEN_STATUSES, type OtStatus } from "@/lib/mantencion/work-order-states"
import { addDaysToPlainDate, chileDayStartInstant, todayInChile } from "@/lib/utils"
import type { MantViewer } from "./access"
import { loadFleet } from "./fleet"
import { fleetScopeFor, loadRecordSeries } from "./panel"
import { meanTimeToRepairHours } from "./work-orders/metrics"
import { workOrderVisibility, workOrderVisibilitySql } from "./work-orders/access"

/**
 * Datos de los Indicadores de mantención (`/mantencion/indicadores`): «cómo nos fue y hacia
 * dónde va», a diferencia del Panel, que es la bandeja de «qué falta hoy».
 *
 * Reglas (las mismas del resto del módulo):
 * - Las OT se acotan con `workOrderVisibilitySql`, igual que la lista de OT: la cifra del tile
 *   y la lista a la que enlaza cuentan lo mismo. Una OT anulada no es trabajo hecho ni pedido,
 *   así que no entra en «creadas», «cerradas» ni en el ranking; sí entra en el backlog histórico
 *   hasta el día en que se anuló (si no, una OT anulada mañana desaparecería de la cola de ayer).
 * - Los registros respetan `recordVisibilitySql` (vía `loadRecordSeries`, la consulta del panel).
 * - Los equipos, `equipmentScope`; el filtro de faena sólo achica, nunca agranda.
 * - Cada loader es independiente: la página envuelve cada uno y un fallo degrada sólo su bloque.
 *
 * Fechas: los baldes y los rangos son días civiles chilenos (`YYYY-MM-DD`). Los instantes
 * (`closed_at`, intervalos operacionales) se llevan a fecha civil de Chile en SQL o con
 * `chileDayStartInstant`, nunca con `new Date().toISOString().slice(0, 10)`.
 *
 * No hay MTBF: el módulo no registra fallas como eventos con duración de operación entre ellas.
 */

export interface MantIndicatorQuery {
  from: string
  to: string
  granularity: IndicatorGranularity
  previous: DateRange
  /** Faena elegida; `undefined` = todas las visibles. */
  worksiteId?: string
  today?: string
}

// ── Helpers puros ──────────────────────────────────────────────────────────

/** Último día civil de un balde: el mismo día, o el último del mes. */
export function bucketLastDay(key: string, granularity: IndicatorGranularity): string {
  if (granularity === "day") return key
  const [year = 1970, month = 1] = key.split("-").map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

/** Primer día civil de un balde. */
export function bucketFirstDay(key: string, granularity: IndicatorGranularity): string {
  return granularity === "day" ? key : `${key.slice(0, 7)}-01`
}

/**
 * Ventana de un balde recortada al rango pedido y a hoy (no se mide el futuro): `[from, to]`
 * inclusive. Un balde que empieza antes del rango (primer mes parcial) arranca en `rangeFrom`.
 */
export function bucketWindow(
  key: string,
  granularity: IndicatorGranularity,
  range: DateRange,
  today: string,
): DateRange {
  const first = bucketFirstDay(key, granularity)
  const last = bucketLastDay(key, granularity)
  const end = [last, range.to, today].reduce((min, value) => (value < min ? value : min))
  return { from: first > range.from ? first : range.from, to: end }
}

export interface WorkOrderSeriesRow {
  requestDate: string
  status: string
  repair: boolean
  maintenance: boolean
  /** Fecha civil de Chile del cierre; `null` si no está cerrada. */
  closedDate: string | null
  /** Fecha civil de Chile de la anulación; `null` si no está anulada. */
  voidedDate: string | null
}

export interface WorkOrderSeriesPoint {
  key: string
  created: number
  closed: number
  /** OT pedidas, no cerradas ni anuladas al terminar el balde (o hoy, si el balde sigue en curso). */
  backlog: number
  repairOnly: number
  maintenanceOnly: number
  both: number
  /** El balde en curso: sus cifras valen sólo hasta hoy. */
  partial: boolean
}

/**
 * OT creadas, cerradas y backlog por balde, más la mezcla reparación/mantención de las
 * creadas. Los baldes vacíos van con ceros (un día sin OT es un cero, no un hueco).
 */
export function buildWorkOrderSeries(
  rows: readonly WorkOrderSeriesRow[],
  query: { from: string; to: string; granularity: IndicatorGranularity; today: string },
): WorkOrderSeriesPoint[] {
  const { from, to, granularity, today } = query
  const keys = listBuckets(from, to, granularity)
  const points = new Map<string, WorkOrderSeriesPoint>(
    keys.map((key) => [key, {
      key, created: 0, closed: 0, backlog: 0, repairOnly: 0, maintenanceOnly: 0, both: 0,
      partial: isPartialBucket(key, granularity, today) && to >= today,
    }]),
  )
  for (const row of rows) {
    if (row.status !== "anulada" && row.requestDate >= from && row.requestDate <= to) {
      const point = points.get(bucketKey(row.requestDate, granularity))
      if (point) {
        point.created += 1
        if (row.repair && row.maintenance) point.both += 1
        else if (row.repair) point.repairOnly += 1
        else point.maintenanceOnly += 1
      }
    }
    if (row.status === "cerrada" && row.closedDate && row.closedDate >= from && row.closedDate <= to) {
      const point = points.get(bucketKey(row.closedDate, granularity))
      if (point) point.closed += 1
    }
  }
  const range = { from, to }
  for (const key of keys) {
    const end = bucketWindow(key, granularity, range, today).to
    let backlog = 0
    for (const row of rows) {
      if (row.requestDate > end) continue
      if (row.closedDate && row.closedDate <= end) continue
      if (row.voidedDate && row.voidedDate <= end) continue
      backlog += 1
    }
    points.get(key)!.backlog = backlog
  }
  return keys.map((key) => points.get(key)!)
}

export interface OperationalInterval {
  startedAt: string
  /** `null` = sigue abierto: cuenta hasta `now`. */
  endedAt: string | null
}

/**
 * Días-equipo que los intervalos de detención se traslapan con cada ventana de días civiles
 * chilenos (`from` y `to` inclusive). Un intervalo abierto termina en `now`; el futuro no se
 * mide. El resultado es fraccionario (horas / 24): 6 horas detenido son 0,25 días-equipo.
 */
export function outOfServiceDaysInWindows(
  intervals: readonly OperationalInterval[],
  windows: readonly DateRange[],
  now: Date,
): number[] {
  const nowMs = now.getTime()
  const spans = intervals.map((interval) => ({
    start: Date.parse(interval.startedAt),
    end: interval.endedAt ? Date.parse(interval.endedAt) : nowMs,
  }))
  return windows.map((window) => {
    const start = Date.parse(chileDayStartInstant(window.from))
    const end = Math.min(Date.parse(chileDayStartInstant(addDaysToPlainDate(window.to, 1))), nowMs)
    if (end <= start) return 0
    let ms = 0
    for (const span of spans) {
      const overlap = Math.min(span.end, end) - Math.max(span.start, start)
      if (overlap > 0) ms += overlap
    }
    return ms / 86_400_000
  })
}

export interface PautaCompliance {
  /** Equipos con pauta (todo menos dados de baja y sin pauta): la base del porcentaje. */
  withSchedule: number
  onTime: number
  /** `null` sin equipos con pauta: no hay porcentaje que inventar. */
  percent: number | null
}

/** % de equipos con la pauta al día: `al_dia / (total − baja − sin_pauta)`. */
export function pautaCompliance(counts: Record<MantEquipmentState, number>): PautaCompliance {
  const withSchedule = counts.vencida + counts.proxima + counts.al_dia + counts.sin_lecturas
  return {
    withSchedule,
    onTime: counts.al_dia,
    percent: withSchedule > 0 ? (counts.al_dia / withSchedule) * 100 : null,
  }
}

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * Variación porcentual contra el período anterior. `null` sin base de comparación (el anterior
 * fue 0): «subió ∞ %» no es una cifra, y el tile prefiere no mostrar variación.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  return ((current - previous) / previous) * 100
}

// ── Órdenes de trabajo ─────────────────────────────────────────────────────

function workOrderScope(viewer: MantViewer, worksiteId: string | undefined): SQL {
  return and(
    workOrderVisibilitySql(workOrderVisibility(viewer)),
    worksiteId ? eq(mantWorkOrders.worksiteId, worksiteId) : undefined,
  )!
}

const SANTIAGO_DAY = (column: AnyColumn) =>
  sql<string | null>`to_char(${column} AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD')`

/** OT creadas / cerradas / backlog por balde y mezcla reparación-mantención. */
export async function loadWorkOrderSeries(viewer: MantViewer, query: MantIndicatorQuery): Promise<WorkOrderSeriesPoint[]> {
  const today = query.today ?? todayInChile()
  const fromInstant = chileDayStartInstant(query.from)
  // Una OT cerrada o anulada antes del rango no cuenta en ningún balde (ni en el backlog).
  const rows = await db.select({
    requestDate: mantWorkOrders.requestDate,
    status: mantWorkOrders.status,
    repair: mantWorkOrders.repair,
    maintenance: mantWorkOrders.maintenance,
    closedDate: SANTIAGO_DAY(mantWorkOrders.closedAt),
    voidedDate: SANTIAGO_DAY(mantWorkOrders.voidedAt),
  })
    .from(mantWorkOrders)
    .where(and(
      workOrderScope(viewer, query.worksiteId),
      lte(mantWorkOrders.requestDate, query.to),
      or(isNull(mantWorkOrders.closedAt), gte(mantWorkOrders.closedAt, fromInstant)),
      or(isNull(mantWorkOrders.voidedAt), gte(mantWorkOrders.voidedAt, fromInstant)),
    ))
  return buildWorkOrderSeries(rows, { from: query.from, to: query.to, granularity: query.granularity, today })
}

export interface WorkOrderPeriodStats {
  closed: number
  closedPrevious: number
  /** Horas promedio en taller de las reparaciones cerradas en el período; `null` si no hubo ninguna que medir. */
  mttrHours: number | null
  repairClosed: number
  /** Suma de `total_cost` de las cerradas del período; `null` si ninguna trae costo cargado. */
  cost: number | null
}

/** Cifras del período para los tiles de OT (mismas definiciones que `getVehicleWorkOrderMetrics`). */
export async function loadWorkOrderPeriodStats(viewer: MantViewer, query: MantIndicatorQuery): Promise<WorkOrderPeriodStats> {
  const start = chileDayStartInstant(query.from)
  const end = chileDayStartInstant(addDaysToPlainDate(query.to, 1))
  const prevStart = chileDayStartInstant(query.previous.from)
  const prevEnd = chileDayStartInstant(addDaysToPlainDate(query.previous.to, 1))
  const closedIn = (a: string, b: string) =>
    sql`${mantWorkOrders.status} = 'cerrada' AND ${mantWorkOrders.closedAt} >= ${a}::timestamptz AND ${mantWorkOrders.closedAt} < ${b}::timestamptz`
  const closedNow = closedIn(start, end)
  const repairMeasured = sql`${closedNow} AND ${mantWorkOrders.repair} AND ${mantWorkOrders.workshopEntryAt} IS NOT NULL AND ${mantWorkOrders.workshopExitAt} IS NOT NULL`
  const [row] = await db.select({
    closed: sql<number>`(COUNT(*) FILTER (WHERE ${closedNow}))::int`,
    closedPrevious: sql<number>`(COUNT(*) FILTER (WHERE ${closedIn(prevStart, prevEnd)}))::int`,
    repairClosed: sql<number>`(COUNT(*) FILTER (WHERE ${closedNow} AND ${mantWorkOrders.repair}))::int`,
    repairHours: sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (${mantWorkOrders.workshopExitAt} - ${mantWorkOrders.workshopEntryAt})) / 3600) FILTER (WHERE ${repairMeasured}), 0)::float8`,
    cost: sql<number | null>`SUM(${mantWorkOrders.totalCost}) FILTER (WHERE ${closedNow})`,
  })
    .from(mantWorkOrders)
    .where(and(ne(mantWorkOrders.status, "anulada"), workOrderScope(viewer, query.worksiteId)))
  const repairClosed = Number(row?.repairClosed ?? 0)
  return {
    closed: Number(row?.closed ?? 0),
    closedPrevious: Number(row?.closedPrevious ?? 0),
    repairClosed,
    mttrHours: meanTimeToRepairHours(repairClosed, Number(row?.repairHours ?? 0)),
    cost: row?.cost == null ? null : Number(row.cost),
  }
}

/** OT abiertas hoy por estado (sólo estados con OT). */
export async function loadOpenWorkOrdersByStatus(
  viewer: MantViewer,
  worksiteId: string | undefined,
): Promise<Array<{ status: OtStatus; count: number }>> {
  const rows = await db.select({ status: mantWorkOrders.status, count: sql<number>`count(*)::int` })
    .from(mantWorkOrders)
    .where(and(inArray(mantWorkOrders.status, [...OT_OPEN_STATUSES]), workOrderScope(viewer, worksiteId)))
    .groupBy(mantWorkOrders.status)
  const byStatus = new Map(rows.map((row) => [row.status, Number(row.count)]))
  // Orden del ciclo de vida, no el de tamaño.
  return OT_OPEN_STATUSES
    .map((status) => ({ status, count: byStatus.get(status) ?? 0 }))
    .filter((item) => item.count > 0)
}

export interface RepairRankingRow {
  vehicleId: string
  code: string
  plate: string
  count: number
}

/**
 * Equipos con más OT de reparación creadas en el rango. Sólo entran los que tienen al menos
 * `minCount` (2 por defecto): con una sola OT cada equipo, el «ranking» es una lista de empates
 * que no distingue a nadie y coronar a uno es inventar un líder.
 */
export async function loadTopRepairEquipment(
  viewer: MantViewer,
  query: Pick<MantIndicatorQuery, "from" | "to" | "worksiteId">,
  limit = 50,
  minCount = 2,
): Promise<RepairRankingRow[]> {
  const count = sql<number>`count(*)::int`
  const rows = await db.select({
    vehicleId: mantWorkOrders.vehicleId,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    count,
  })
    .from(mantWorkOrders)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantWorkOrders.vehicleId))
    .where(and(
      eq(mantWorkOrders.repair, true),
      ne(mantWorkOrders.status, "anulada"),
      gte(mantWorkOrders.requestDate, query.from),
      lte(mantWorkOrders.requestDate, query.to),
      workOrderScope(viewer, query.worksiteId),
    ))
    .groupBy(mantWorkOrders.vehicleId, fuelVehicles.code, fuelVehicles.plate)
    .having(sql`count(*) >= ${minCount}`)
    .orderBy(desc(count), fuelVehicles.plate)
    .limit(limit)
  return rows.map((row) => ({ vehicleId: row.vehicleId, code: row.code ?? row.plate, plate: row.plate, count: Number(row.count) }))
}

// ── Pautas, registros y disponibilidad ─────────────────────────────────────

export interface PautaState {
  counts: Record<MantEquipmentState, number>
  total: number
}

/** Estado de las pautas hoy: la única fuente es `loadFleet` (igual que el panel). */
export async function loadPautaState(viewer: MantViewer, worksiteId: string | undefined, today: string = todayInChile()): Promise<PautaState> {
  const fleet = await loadFleet({ scope: fleetScopeFor(viewer, worksiteId), today })
  const counts = Object.fromEntries(MANT_EQUIPMENT_STATES.map((state) => [state, 0])) as Record<MantEquipmentState, number>
  for (const row of fleet) counts[row.status.state] += 1
  return { counts, total: fleet.length }
}

export interface RecordSeriesPoint {
  key: string
  preventive: number
  corrective: number
  partial: boolean
}

export interface RecordIndicators {
  points: RecordSeriesPoint[]
  preventive: number
  preventivePrevious: number
}

/** Registros preventivos vs correctivos por balde y total preventivo contra el período anterior. */
export async function loadRecordIndicators(viewer: MantViewer, query: MantIndicatorQuery): Promise<RecordIndicators> {
  const today = query.today ?? todayInChile()
  const [current, previous] = await Promise.all([
    loadRecordSeries(viewer, { from: query.from, to: query.to, granularity: query.granularity, worksiteId: query.worksiteId }),
    loadRecordSeries(viewer, { from: query.previous.from, to: query.previous.to, granularity: "month", worksiteId: query.worksiteId }),
  ])
  const keys = listBuckets(query.from, query.to, query.granularity)
  const points = new Map<string, RecordSeriesPoint>(
    keys.map((key) => [key, { key, preventive: 0, corrective: 0, partial: isPartialBucket(key, query.granularity, today) && query.to >= today }]),
  )
  for (const row of current) {
    const point = points.get(bucketKey(row.bucket, query.granularity))
    if (point) point[row.kind === "P" ? "preventive" : "corrective"] += row.n
  }
  const list = keys.map((key) => points.get(key)!)
  return {
    points: list,
    preventive: list.reduce((sum, point) => sum + point.preventive, 0),
    preventivePrevious: previous.filter((row) => row.kind === "P").reduce((sum, row) => sum + row.n, 0),
  }
}

export interface OutOfServicePoint {
  key: string
  /** Días-equipo detenidos en el balde (1 decimal). */
  days: number
  partial: boolean
}

export interface OutOfServiceIndicators {
  points: OutOfServicePoint[]
  total: number
  totalPrevious: number
}

/**
 * Días-equipo fuera de servicio por balde: traslape de los intervalos operacionales en
 * `mantencion` o `fuera_servicio` (los dos estados que el Panel operacional cuenta como
 * detenido, `countStoppedVehicles`) de los equipos activos del alcance.
 */
export async function loadOutOfService(viewer: MantViewer, query: MantIndicatorQuery, now: Date = new Date()): Promise<OutOfServiceIndicators> {
  const today = query.today ?? todayInChile(now)
  const rangeStart = chileDayStartInstant(query.previous.from)
  const rangeEnd = chileDayStartInstant(addDaysToPlainDate(query.to, 1))
  const intervals = await db.select({
    startedAt: fuelVehicleOperationalIntervals.startedAt,
    endedAt: fuelVehicleOperationalIntervals.endedAt,
  })
    .from(fuelVehicleOperationalIntervals)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelVehicleOperationalIntervals.vehicleId))
    .where(and(
      eq(fuelVehicles.isActive, true),
      inArray(fuelVehicleOperationalIntervals.status, ["mantencion", "fuera_servicio"]),
      worksiteScopeSqlFor(fleetScopeFor(viewer, query.worksiteId), fuelVehicles.worksiteId),
      lt(fuelVehicleOperationalIntervals.startedAt, rangeEnd),
      or(isNull(fuelVehicleOperationalIntervals.endedAt), gte(fuelVehicleOperationalIntervals.endedAt, rangeStart)),
    ))
  const keys = listBuckets(query.from, query.to, query.granularity)
  const range = { from: query.from, to: query.to }
  const windows = [
    ...keys.map((key) => bucketWindow(key, query.granularity, range, today)),
    // La ventana del período completo y la del anterior: el total no es la suma de los
    // baldes redondeados a 1 decimal.
    { from: query.from, to: query.to < today ? query.to : today },
    query.previous,
  ]
  const days = outOfServiceDaysInWindows(intervals, windows, now)
  const bucketDays = days.slice(0, keys.length)
  return {
    points: keys.map((key, index) => ({
      key,
      days: round1(bucketDays[index] ?? 0),
      partial: isPartialBucket(key, query.granularity, today) && query.to >= today,
    })),
    total: round1(days[keys.length] ?? 0),
    totalPrevious: round1(days[keys.length + 1] ?? 0),
  }
}

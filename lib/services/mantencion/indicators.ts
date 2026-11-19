import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicleOperationalIntervals, fuelVehicles, fuelVehicleWorksiteIntervals, mantWorkOrders } from "@/db/schema"
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
 * Datos de los gráficos del Panel de mantención (`/mantencion/panel`): «cómo nos fue y hacia
 * dónde va». Lo pendiente de hoy va en la franja «Hoy» de arriba del mismo Panel.
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
  /** El período medido (cortado en hoy): cifras, totales, rankings. */
  from: string
  to: string
  granularity: IndicatorGranularity
  previous: DateRange
  /**
   * Ventana de los gráficos de evolución (`period.chart`): el propio período si abarca tres meses o más; si no,
   * los seis meses que terminan en él, por mes. Las series (`points`) la siguen; los totales y las cifras
   * contra el período anterior, no.
   */
  chart: { from: string; to: string; granularity: IndicatorGranularity }
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

export interface OperationalIntervalInStay extends OperationalInterval {
  /** Primer día de la estadía (`YYYY-MM-DD`); `null` = desde siempre. */
  stayStartedOn: string | null
  /** Último día de la estadía, inclusivo; `null` = la vigente. */
  stayEndedOn: string | null
}

/**
 * Recorta cada intervalo a la estadía con la que se une: inicio = el mayor entre el del intervalo y el
 * comienzo del día `stayStartedOn`; fin = el menor entre el del intervalo (`null` = abierto) y el comienzo
 * del día siguiente a `stayEndedOn`. Lo que queda vacío (no solapa) se descarta. El resultado alimenta a
 * `outOfServiceDaysInWindows` sin cambios.
 */
export function clipToStays(rows: readonly OperationalIntervalInStay[]): OperationalInterval[] {
  const clipped: OperationalInterval[] = []
  for (const row of rows) {
    const stayStart = row.stayStartedOn ? chileDayStartInstant(row.stayStartedOn) : null
    const stayEnd = row.stayEndedOn ? chileDayStartInstant(addDaysToPlainDate(row.stayEndedOn, 1)) : null
    const startMs = Math.max(Date.parse(row.startedAt), stayStart ? Date.parse(stayStart) : -Infinity)
    const endMs = Math.min(row.endedAt ? Date.parse(row.endedAt) : Infinity, stayEnd ? Date.parse(stayEnd) : Infinity)
    if (endMs <= startMs) continue
    clipped.push({
      startedAt: new Date(startMs).toISOString(),
      // Abierto sólo si ni el intervalo ni la estadía tienen fin.
      endedAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    })
  }
  return clipped
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

/**
 * OT creadas / cerradas / backlog por balde y mezcla reparación-mantención, sobre la ventana de los
 * gráficos (`query.chart`), no sobre el período: la serie no entrega totales, así que no hay nada que
 * recortar al período.
 */
export async function loadWorkOrderSeries(viewer: MantViewer, query: MantIndicatorQuery): Promise<WorkOrderSeriesPoint[]> {
  const today = query.today ?? todayInChile()
  const { chart } = query
  const fromInstant = chileDayStartInstant(chart.from)
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
      lte(mantWorkOrders.requestDate, chart.to),
      or(isNull(mantWorkOrders.closedAt), gte(mantWorkOrders.closedAt, fromInstant)),
      or(isNull(mantWorkOrders.voidedAt), gte(mantWorkOrders.voidedAt, fromInstant)),
    ))
  return buildWorkOrderSeries(rows, { from: chart.from, to: chart.to, granularity: chart.granularity, today })
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
  /** Equipos detenidos en taller hoy (correctiva u OT abierta): la misma regla que la ficha y Equipos «En taller». */
  inWorkshop: number
  /**
   * De esos, los que están por una OT en ejecución; el resto, por una correctiva sin OT. El Panel lo dice
   * junto a la cifra porque el gráfico de OT de al lado cuenta OT en la etapa «En taller», no equipos, y
   * «Equipos en taller 6» sobre «En taller 4 OT» se leía como una contradicción (crítica 2026-11-15).
   */
  inWorkshopByOrder: number
}

/** Estado de las pautas hoy: la única fuente es `loadFleet`. */
export async function loadPautaState(viewer: MantViewer, worksiteId: string | undefined, today: string = todayInChile()): Promise<PautaState> {
  const fleet = await loadFleet({ scope: fleetScopeFor(viewer, worksiteId), today })
  const counts = Object.fromEntries(MANT_EQUIPMENT_STATES.map((state) => [state, 0])) as Record<MantEquipmentState, number>
  for (const row of fleet) counts[row.status.state] += 1
  const inWorkshop = fleet.filter((row) => row.workshop)
  return {
    counts,
    total: fleet.length,
    inWorkshop: inWorkshop.length,
    inWorkshopByOrder: inWorkshop.filter((row) => row.workshop?.workOrderId).length,
  }
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

/**
 * Registros preventivos vs correctivos por balde de la ventana de los gráficos (`query.chart`), y total
 * preventivo del período contra el anterior (`query.from/to` y `query.previous`).
 *
 * Una sola consulta: se trae por día la unión de la ventana del gráfico y del período anterior (la ventana
 * siempre contiene al período) y se reparte en JS: los baldes del gráfico, el total del período y el del
 * anterior. Tres consultas por rango harían lo mismo con más idas a la base.
 */
export async function loadRecordIndicators(viewer: MantViewer, query: MantIndicatorQuery): Promise<RecordIndicators> {
  const today = query.today ?? todayInChile()
  const { chart } = query
  const unionFrom = [chart.from, query.previous.from, query.from].reduce((min, value) => (value < min ? value : min))
  const unionTo = chart.to > query.to ? chart.to : query.to
  const rows = await loadRecordSeries(viewer, { from: unionFrom, to: unionTo, granularity: "day", worksiteId: query.worksiteId })
  const keys = listBuckets(chart.from, chart.to, chart.granularity)
  const points = new Map<string, RecordSeriesPoint>(
    keys.map((key) => [key, { key, preventive: 0, corrective: 0, partial: isPartialBucket(key, chart.granularity, today) && chart.to >= today }]),
  )
  let preventive = 0
  let preventivePrevious = 0
  for (const row of rows) {
    // `bucket` es el día (`YYYY-MM-DD`) de la fecha de trabajo.
    if (row.bucket >= chart.from && row.bucket <= chart.to) {
      const point = points.get(bucketKey(row.bucket, chart.granularity))
      if (point) point[row.kind === "P" ? "preventive" : "corrective"] += row.n
    }
    if (row.kind !== "P") continue
    if (row.bucket >= query.from && row.bucket <= query.to) preventive += row.n
    if (row.bucket >= query.previous.from && row.bucket <= query.previous.to) preventivePrevious += row.n
  }
  return { points: keys.map((key) => points.get(key)!), preventive, preventivePrevious }
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
 * Días-equipo fuera de servicio por balde de la ventana de los gráficos (`query.chart`): traslape de los intervalos operacionales en
 * `mantencion` o `fuera_servicio` (los dos estados que el Panel operacional cuenta como
 * detenido, `countStoppedVehicles`) de los equipos activos del alcance. El total y el del período
 * anterior se miden sobre el período (`query.from/to`, `query.previous`), no sobre la ventana: una sola
 * consulta de intervalos (la unión de ambos rangos) y cada cifra se calcula con su propia ventana.
 */
export async function loadOutOfService(viewer: MantViewer, query: MantIndicatorQuery, now: Date = new Date()): Promise<OutOfServiceIndicators> {
  const today = query.today ?? todayInChile(now)
  const { chart } = query
  const earliest = [chart.from, query.previous.from, query.from].reduce((min, value) => (value < min ? value : min))
  const latest = chart.to > query.to ? chart.to : query.to
  const rangeStart = chileDayStartInstant(earliest)
  const rangeEnd = chileDayStartInstant(addDaysToPlainDate(latest, 1))
  // Cada intervalo se une con las estadías del equipo que lo solapan y se recorta a la intersección: un
  // día detenido cuenta en la faena donde estaba el equipo ese día (el del traslado, en la nueva), y el
  // alcance y el filtro de faena miden esa faena, no la actual. La estadía sin inicio es «desde siempre» y
  // sin fin es la vigente; `ended_on` es inclusivo, así que el corte es el inicio del día siguiente.
  const rows = await db.select({
    startedAt: fuelVehicleOperationalIntervals.startedAt,
    endedAt: fuelVehicleOperationalIntervals.endedAt,
    stayStartedOn: fuelVehicleWorksiteIntervals.startedOn,
    stayEndedOn: fuelVehicleWorksiteIntervals.endedOn,
  })
    .from(fuelVehicleOperationalIntervals)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fuelVehicleOperationalIntervals.vehicleId))
    .innerJoin(fuelVehicleWorksiteIntervals, eq(fuelVehicleWorksiteIntervals.vehicleId, fuelVehicleOperationalIntervals.vehicleId))
    .where(and(
      eq(fuelVehicles.isActive, true),
      inArray(fuelVehicleOperationalIntervals.status, ["mantencion", "fuera_servicio"]),
      worksiteScopeSqlFor(fleetScopeFor(viewer, query.worksiteId), fuelVehicleWorksiteIntervals.worksiteId),
      lt(fuelVehicleOperationalIntervals.startedAt, rangeEnd),
      or(isNull(fuelVehicleOperationalIntervals.endedAt), gte(fuelVehicleOperationalIntervals.endedAt, rangeStart)),
      // La estadía debe tocar el rango: texto contra texto (fechas civiles).
      or(isNull(fuelVehicleWorksiteIntervals.startedOn), lte(fuelVehicleWorksiteIntervals.startedOn, latest)),
      or(isNull(fuelVehicleWorksiteIntervals.endedOn), gte(fuelVehicleWorksiteIntervals.endedOn, earliest)),
    ))
  const intervals = clipToStays(rows)
  const keys = listBuckets(chart.from, chart.to, chart.granularity)
  const range = { from: chart.from, to: chart.to }
  const windows = [
    ...keys.map((key) => bucketWindow(key, chart.granularity, range, today)),
    // La ventana del período completo y la del anterior: el total no es la suma de los baldes
    // (redondeados a 1 decimal y, con la ventana de seis meses, de más meses que el período).
    { from: query.from, to: query.to < today ? query.to : today },
    query.previous,
  ]
  const days = outOfServiceDaysInWindows(intervals, windows, now)
  const bucketDays = days.slice(0, keys.length)
  return {
    points: keys.map((key, index) => ({
      key,
      days: round1(bucketDays[index] ?? 0),
      partial: isPartialBucket(key, chart.granularity, today) && chart.to >= today,
    })),
    total: round1(days[keys.length] ?? 0),
    totalPrevious: round1(days[keys.length + 1] ?? 0),
  }
}

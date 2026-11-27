import { suggestInterval } from "@/lib/mantencion/schedule"
import { todayInChile } from "@/lib/utils"
import type { MantViewer } from "../access"
import { loadFleet, type FleetRow } from "../fleet"
import { queryFilters } from "./filters"
import { effectiveWorksiteIds } from "./resolve"
import { estimateNextDate } from "./planning-estimate"
import { planningStateOf } from "./planning-rules"
import { PLANNING_STATES, type CrossDimension, type LookerFilters, type PlanningData, type PlanningRow, type ResolvedCrossFilters } from "./types"

/**
 * Datos de la pestaña Planificación. `loadFleet` es la única fuente del estado de un equipo:
 * lecturas, última preventiva, intervalos y la próxima que calcula `equipmentStatus`.
 *
 * A = punto programado de la última mantención (`suggestInterval`, «tocaba a los»), B = lectura real de esa
 * mantención («se hizo a los»). El delta es A − B y los faltantes son `status.remaining` (próxima − lectura actual).
 * La próxima usa la regla vigente del módulo: punto de la última preventiva + intervalo base. La fecha estimada
 * (`planning-estimate.ts`) es una referencia y nunca cambia el estado.
 */

export { planningStateOf, remainingTone, timingText, timingTone, type PlanningTone } from "./planning-rules"

function signedPreventive(row: FleetRow) {
  if (row.status.lastPreventive?.origin !== "firmada") return undefined
  const last = row.status.lastPreventive
  return row.recentPreventives.find((item) => item.date === last.date && item.reading === last.reading) ?? row.recentPreventives[0]
}

export function toPlanningRow(row: FleetRow, period: { from: string; to: string }, today: string = todayInChile()): PlanningRow {
  const last = row.status.lastPreventive
  const signed = signedPreventive(row)
  const base = row.intervals.length ? row.intervals[0]! : null
  const programmed = last && row.intervals.length ? suggestInterval(row.intervals, last.reading, row.cyclic).point : null
  const real = last?.reading ?? null
  const current = row.status.currentReading?.value ?? null
  const frequency = last?.intervalValue && last.intervalValue > 0 ? last.intervalValue : null
  const manual = !!signed && signed.suggestedIntervalValue != null && signed.intervalValue !== signed.suggestedIntervalValue
  const estimate = estimateNextDate({
    unit: row.unit,
    readings: row.readings,
    gps: row.gpsReading != null && row.gpsReadingAt ? { value: row.gpsReading, at: row.gpsReadingAt } : null,
    current: row.status.currentReading ? { value: row.status.currentReading.value, date: row.status.currentReading.date } : null,
    remaining: row.status.remaining,
    today,
  })
  return {
    vehicleId: row.vehicleId,
    code: row.code,
    plate: row.plate,
    label: row.code === row.plate ? row.code : `${row.code} · ${row.plate}`,
    typeName: row.typeName,
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    unit: row.unit,
    scheduleName: row.scheduleName,
    intervals: row.intervals,
    frequency,
    lastDate: last?.date ?? null,
    programmed,
    real,
    current,
    next: row.status.nextReading,
    delta: programmed != null && real != null ? programmed - real : null,
    remaining: row.status.remaining,
    base,
    state: row.status.state,
    declared: last?.origin === "declarada",
    evidence: last?.origin === "declarada" ? last.evidence?.trim() || null : null,
    manual,
    manualReason: manual ? signed?.manualScheduleReason?.trim() || null : null,
    outOfRange: !!last && (last.date < period.from || last.date > period.to),
    dailyUsage: estimate.dailyUsage,
    estimatedDate: estimate.estimatedDate,
    estimateNote: estimate.note,
  }
}

function sortPlanning(rows: PlanningRow[]): PlanningRow[] {
  return [...rows].sort((a, b) => {
    const left = a.remaining == null ? Number.POSITIVE_INFINITY : a.remaining
    const right = b.remaining == null ? Number.POSITIVE_INFINITY : b.remaining
    if (left !== right) return left - right
    return a.code.localeCompare(b.code, "es", { numeric: true })
  })
}

/**
 * Rango de fechas de la URL: con `dateField=proxima` filtra por la fecha estimada y con `ultima` por la de la última
 * mantención. Con algún extremo activo, una fila sin esa fecha (sin lecturas, sin pauta, sin mantención) queda fuera:
 * no se puede decir que cae en el rango.
 */
export function matchesDateRange(row: Pick<PlanningRow, "estimatedDate" | "lastDate">, filters: Pick<LookerFilters, "dateField" | "dateFrom" | "dateTo">): boolean {
  if (!filters.dateFrom && !filters.dateTo) return true
  const date = filters.dateField === "ultima" ? row.lastDate : row.estimatedDate
  if (!date) return false
  if (filters.dateFrom && date < filters.dateFrom) return false
  if (filters.dateTo && date > filters.dateTo) return false
  return true
}

/**
 * De las filas de la unidad a lo que dibuja la pestaña. La tira de cifras (`counts`) se cuenta con todos los filtros
 * salvo `estado`, que es justamente lo que ella elige; la tabla y los gráficos, con todos.
 */
export function buildPlanningData(
  allRows: readonly PlanningRow[],
  filters: Pick<LookerFilters, "dateField" | "dateFrom" | "dateTo" | "planningState">,
  selectedId: string | null,
): PlanningData {
  let rows = allRows.filter((row) => matchesDateRange(row, filters))
  const counts = Object.fromEntries(PLANNING_STATES.map((state) => [state, 0])) as PlanningData["counts"]
  counts.total = rows.length
  for (const row of rows) counts[planningStateOf(row)] += 1
  if (filters.planningState) rows = rows.filter((row) => planningStateOf(row) === filters.planningState)
  return { rows: sortPlanning(rows), counts, selectedId }
}

/**
 * Filas de Planificación de la unidad de la pestaña, con los filtros efectivos. `ignore` permite que el bloque que
 * emitió un clic no se filtre a sí mismo.
 */
export async function loadPlanningData(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  ignore: readonly CrossDimension[] = [],
): Promise<PlanningData> {
  const query = queryFilters(filters, cross, ignore)
  const scope = effectiveWorksiteIds(viewer, query.worksiteIds)
  const today = todayInChile()
  const fleet = await loadFleet({
    scope,
    today,
    ...(query.equipmentIds.length ? { vehicleIds: query.equipmentIds } : {}),
  })
  let rows = fleet.filter((row) => row.unit === filters.unit).map((row) => toPlanningRow(row, filters, today))
  if (query.frequencies.length) {
    const allowed = new Set(query.frequencies)
    rows = rows.filter((row) => row.intervals.some((value) => allowed.has(value)))
  }
  return buildPlanningData(rows, filters, cross.equipment?.id ?? null)
}

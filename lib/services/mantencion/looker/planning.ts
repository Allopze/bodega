import { suggestInterval } from "@/lib/mantencion/schedule"
import { todayInChile } from "@/lib/utils"
import type { MantViewer } from "../access"
import { loadFleet, type FleetRow } from "../fleet"
import { queryFilters } from "./filters"
import { effectiveWorksiteIds } from "./resolve"
import type { CrossDimension, LookerFilters, PlanningData, PlanningRow, ResolvedCrossFilters } from "./types"

/**
 * Datos de la pestaña Planificación. `loadFleet` es la única fuente del estado de un equipo:
 * lecturas, última preventiva, intervalos y la próxima que calcula `equipmentStatus`.
 *
 * A = punto programado de la última mantención (`suggestInterval`), B = lectura real de esa
 * mantención. El delta es A − B y los faltantes son `status.remaining` (próxima − lectura actual).
 * La próxima usa la regla vigente del módulo: punto de la última preventiva + intervalo base.
 */

export { deltaTone, remainingTone, type PlanningTone } from "./planning-rules"

function signedPreventive(row: FleetRow) {
  if (row.status.lastPreventive?.origin !== "firmada") return undefined
  const last = row.status.lastPreventive
  return row.recentPreventives.find((item) => item.date === last.date && item.reading === last.reading) ?? row.recentPreventives[0]
}

export function toPlanningRow(row: FleetRow, period: { from: string; to: string }): PlanningRow {
  const last = row.status.lastPreventive
  const signed = signedPreventive(row)
  const base = row.intervals.length ? row.intervals[0]! : null
  const programmed = last && row.intervals.length ? suggestInterval(row.intervals, last.reading).point : null
  const real = last?.reading ?? null
  const current = row.status.currentReading?.value ?? null
  const frequency = last?.intervalValue && last.intervalValue > 0 ? last.intervalValue : null
  const manual = !!signed && signed.suggestedIntervalValue != null && signed.intervalValue !== signed.suggestedIntervalValue
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
 * Filas de Planificación con los filtros efectivos. `ignore` permite que la tabla que emitió un
 * clic no se filtre a sí misma; la tabla de horas aplica el equipo elegido y, si es de km, queda
 * vacía con su mensaje contextual.
 */
export async function loadPlanningData(
  viewer: MantViewer,
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  ignore: readonly CrossDimension[] = [],
): Promise<PlanningData> {
  const query = queryFilters(filters, cross, ignore)
  const scope = effectiveWorksiteIds(viewer, query.worksiteIds)
  const fleet = await loadFleet({
    scope,
    today: todayInChile(),
    ...(query.equipmentIds.length ? { vehicleIds: query.equipmentIds } : {}),
  })
  let rows = fleet.map((row) => toPlanningRow(row, filters))
  if (query.frequencies.length) {
    const allowed = new Set(query.frequencies)
    rows = rows.filter((row) => row.intervals.some((value) => allowed.has(value)))
  }
  rows = sortPlanning(rows)
  return {
    km: rows.filter((row) => row.unit === "km"),
    hours: rows.filter((row) => row.unit === "h"),
    selectedId: cross.equipment?.id ?? null,
  }
}

/** Texto del vacío cuando el equipo elegido se controla por la otra unidad. */
export function unitMismatchMessage(selected: ResolvedCrossFilters["equipment"], shown: "km" | "h"): string | null {
  if (!selected?.unit || selected.unit === shown) return null
  const name = selected.code || selected.plate
  return shown === "h"
    ? `${name} se controla por km; no tiene registros por horas.`
    : `${name} se controla por horas; no tiene registros por kilómetros.`
}

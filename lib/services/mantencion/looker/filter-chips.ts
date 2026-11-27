import { formatDate } from "@/lib/utils"
import { monthLabel } from "./filters"
import type { FilterChip, LookerFilters, LookerOptions, PlanningState, ResolvedCrossFilters } from "./types"

/** Chips de la barra de filtros del tablero Looker. Módulo PURO. */

export const PLANNING_STATE_LABEL: Record<PlanningState, string> = {
  vencida: "Vencidas",
  proxima: "Próximas",
  al_dia: "Al día",
  sin_dato: "Sin pauta o lectura",
}

/** «Próxima mantención: hasta 27-12-2026», «Última mantención: 01-06-2026 al 30-09-2026». */
export function dateRangeChipValue(filters: Pick<LookerFilters, "dateField" | "dateFrom" | "dateTo">): string | null {
  const { dateFrom, dateTo } = filters
  if (!dateFrom && !dateTo) return null
  const range = dateFrom && dateTo
    ? `${formatDate(dateFrom)} al ${formatDate(dateTo)}`
    : dateFrom ? `desde ${formatDate(dateFrom)}` : `hasta ${formatDate(dateTo!)}`
  return range
}

/** Chips de la barra. Un valor manual y su equivalente cruzado se muestran una sola vez. */
export function filterChips(filters: LookerFilters, options: LookerOptions, cross: ResolvedCrossFilters): FilterChip[] {
  const chips: FilterChip[] = []
  const seen = new Set<string>()
  const push = (chip: FilterChip, dedupeKey: string) => {
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    chips.push(chip)
  }
  const worksiteName = (id: string) => options.worksites.find((site) => site.id === id)?.name ?? id
  const equipmentLabel = (id: string) => options.equipment.find((equipment) => equipment.id === id)?.label ?? id

  for (const id of filters.worksiteIds) {
    push({ key: `faena:${id}`, label: "Faena", value: id, displayValue: worksiteName(id), param: "faena" }, `faena:${id}`)
  }
  for (const id of filters.equipmentIds) {
    push({ key: `equipo:${id}`, label: "Equipo", value: id, displayValue: equipmentLabel(id), param: "equipo" }, `equipo:${id}`)
  }
  for (const value of filters.frequencies) {
    const option = options.frequencies.find((frequency) => frequency.value === value)
    const label = option?.label ?? String(value)
    push({ key: `frecuencia:${value}`, label: "Frecuencia", value: String(value), displayValue: label, param: "frecuencia" }, `frecuencia:${value}`)
  }
  if (filters.tab === "planificacion") {
    if (filters.planningState) {
      push({ key: `estado:${filters.planningState}`, label: "Estado", value: filters.planningState, displayValue: PLANNING_STATE_LABEL[filters.planningState], param: "estado" }, "estado")
    }
    const range = dateRangeChipValue(filters)
    if (range) {
      push({
        key: "fecha",
        label: filters.dateField === "ultima" ? "Última mantención" : "Próxima mantención",
        value: range,
        displayValue: range,
        // Quitar el chip suelta los dos extremos y `fecha` (ver `removeChipHref`).
        param: filters.dateTo ? "fecha_hasta" : "fecha_desde",
      }, "fecha")
    }
  }
  if (cross.equipment && !cross.equipment.derivedFrom) {
    const shown = cross.equipment.plate && cross.equipment.plate !== cross.equipment.code ? cross.equipment.plate : cross.equipment.code
    push({ key: `x_equipo:${cross.equipment.id}`, label: cross.equipment.plate ? "Patente" : "Código", value: cross.equipment.id, displayValue: shown, param: "x_equipo" }, `equipo:${cross.equipment.id}`)
  }
  if (cross.work) {
    push({ key: `x_ot:${cross.work.id}`, label: cross.work.id.startsWith("ot:") ? "OT" : "Trabajo", value: cross.work.id, displayValue: cross.work.label, param: "x_ot" }, `work:${cross.work.id}`)
  }
  if (cross.check) {
    push({ key: `x_check:${cross.check.id}`, label: "Mantención", value: cross.check.id, displayValue: cross.check.label, param: "x_check" }, `check:${cross.check.id}`)
  }
  if (cross.conductor) {
    push({ key: `x_conductor:${cross.conductor.key}`, label: "Conductor", value: cross.conductor.key, displayValue: cross.conductor.label, param: "x_conductor" }, `conductor:${cross.conductor.key}`)
  }
  if (cross.month) {
    push({ key: `x_mes:${cross.month.key}`, label: "Mes", value: cross.month.key, displayValue: monthLabel(cross.month.key), param: "x_mes" }, `mes:${cross.month.key}`)
  }
  if (cross.worksite) {
    push({ key: `x_faena:${cross.worksite.id}`, label: "Faena", value: cross.worksite.id, displayValue: cross.worksite.name, param: "x_faena" }, `faena:${cross.worksite.id}`)
  }
  if (cross.mechanic) {
    push({ key: `x_mecanico:${cross.mechanic.key}`, label: "Mecánico", value: cross.mechanic.key, displayValue: cross.mechanic.label, param: "x_mecanico" }, `mechanic:${cross.mechanic.key}`)
  }
  return chips
}

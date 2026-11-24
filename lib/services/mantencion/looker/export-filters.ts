import type { ReportCell, ReportSheet } from "@/lib/reports/export-module/types"
import { formatDate } from "@/lib/utils"
import { frequencyLabel } from "./filters"
import type { LookerContext, LookerTab } from "./types"

/**
 * Hoja «Filtros» del Excel: con qué filtros se armó el libro (lo que la pantalla muestra en la barra y en los
 * chips) y las notas de lectura. Es lo que impide leer una hoja de datos sin saber de qué período, faena o
 * selección sale. Módulo PURO.
 */

export type ExportTab = Exclude<LookerTab, "hoy">

export const EXPORT_TAB_LABEL: Record<ExportTab, string> = {
  planificacion: "Planificación",
  camiones: "Camiones (equipos por kilómetros)",
  maquinas: "Máquinas (equipos por horas)",
}

/** «Camiones», «Planificación»: el nombre corto, para el título del libro y el nombre del archivo. */
export const EXPORT_TAB_SHORT: Record<ExportTab, string> = {
  planificacion: "Planificación",
  camiones: "Camiones",
  maquinas: "Máquinas",
}

const dates = (from: string, to: string) => `${formatDate(from)} al ${formatDate(to)}`

function periodText(filters: LookerContext["filters"]): string {
  const effective = dates(filters.from, filters.to)
  if (filters.invalidPeriod) return `${effective} (El rango de la dirección no era válido: se usó el período por defecto)`
  if (filters.requestedTo !== filters.to) return `${effective} (se mide hasta hoy; se pidió hasta el ${formatDate(filters.requestedTo)})`
  return effective
}

export function filtersSheet({ tab, context, notes }: { tab: ExportTab; context: LookerContext; notes: readonly string[] }): ReportSheet {
  const { filters, options, cross } = context
  const rows: ReportCell[][] = []

  rows.push(["Pestaña", EXPORT_TAB_LABEL[tab]])
  rows.push(["Período", periodText(filters)])

  // Una faena que no está en el alcance no se nombra (ni se repite el valor de la URL): se dice que no hay datos.
  const known = filters.worksiteIds.flatMap((id) => options.worksites.find((site) => site.id === id)?.name ?? [])
  const unknown = filters.worksiteIds.length - known.length
  const worksiteText = filters.worksiteIds.length === 0
    ? "Todas las faenas de tu alcance"
    : [known.join(", "), unknown > 0 ? `${unknown} ${unknown === 1 ? "faena fuera de tu alcance" : "faenas fuera de tu alcance"}: sin datos` : ""].filter(Boolean).join("; ")
  rows.push(["Faenas", worksiteText])

  const equipment = filters.equipmentIds.flatMap((id) => options.equipment.find((item) => item.id === id)?.label ?? [])
  rows.push(["Códigos (equipos)", filters.equipmentIds.length === 0 ? "Todos" : equipment.join(", ") || "Fuera de tu alcance: sin datos"])

  const frequencies = filters.frequencies.map((value) => {
    const option = options.frequencies.find((item) => item.value === value)
    return option?.label ?? frequencyLabel(value, tab === "maquinas" ? "h" : "km")
  })
  rows.push(["Frecuencia", frequencies.length === 0 ? "Todas" : frequencies.join(", ")])

  const crossRows: ReportCell[][] = []
  // Un equipo derivado de una OT o de una pauta no es un filtro cruzado propio: el chip tampoco lo muestra.
  if (cross.equipment && !cross.equipment.derivedFrom) crossRows.push(["Filtro cruzado: Equipo", cross.equipment.label])
  if (cross.work) crossRows.push([`Filtro cruzado: ${cross.work.id.startsWith("ot:") ? "OT" : "Trabajo"}`, cross.work.label])
  if (cross.check) crossRows.push(["Filtro cruzado: Mantención", cross.check.label])
  if (cross.conductor) crossRows.push(["Filtro cruzado: Conductor", cross.conductor.label])
  if (cross.month) crossRows.push(["Filtro cruzado: Mes", cross.month.label])
  if (cross.worksite) crossRows.push(["Filtro cruzado: Faena", cross.worksite.name])
  if (cross.mechanic) crossRows.push(["Filtro cruzado: Mecánico", cross.mechanic.label])
  rows.push(...(crossRows.length > 0 ? crossRows : [["Filtros cruzados", "Ninguno"]]))

  for (const note of notes) rows.push(["Nota", note])
  return { worksheetName: "Filtros", headers: ["Concepto", "Detalle"], rows }
}

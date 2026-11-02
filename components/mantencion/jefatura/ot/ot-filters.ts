import type { StageTab } from "@/components/ui/stage-tabs"
import type { WorkOrderListFilters, WorkOrderTab } from "@/lib/services/mantencion/work-orders/query"

// Ojo: sólo `import type` del servicio. Este módulo lo importan componentes de cliente y el
// servicio (`query.ts`) trae la base de datos; un import de valor la metería en el bundle.
export type RawSearchParams = Record<string, string | string[] | undefined>

export const OT_PAGE_SIZE = 25

/** Parámetros de la URL que son filtros (los que limpia «Limpiar filtros»; la pestaña `estado` no). */
export const OT_FILTER_PARAMS = ["faena", "equipo", "mecanico", "desde", "hasta", "q"] as const

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function first(raw: RawSearchParams, key: string): string | undefined {
  const value = raw[key]
  const text = Array.isArray(value) ? value[0] : value
  const trimmed = text?.trim()
  return trimmed ? trimmed : undefined
}

export function isWorkOrderTab(value: string | undefined): value is WorkOrderTab {
  return !!value && Object.hasOwn(OT_TAB_LABELS, value)
}

/**
 * La URL de la lista (`?estado=&faena=&equipo=&mecanico=&desde=&hasta=&q=&pagina=`)
 * como filtros del servicio. Sin `estado` rige «Abiertas». Un valor de fecha mal
 * formado se ignora en vez de llegar a la consulta.
 */
export function parseWorkOrderQuery(raw: RawSearchParams): WorkOrderListFilters {
  const estado = first(raw, "estado")
  const desde = first(raw, "desde")
  const hasta = first(raw, "hasta")
  const page = Number.parseInt(first(raw, "pagina") ?? "1", 10)
  return {
    tab: isWorkOrderTab(estado) ? estado : "abiertas",
    worksiteId: first(raw, "faena"),
    vehicleId: first(raw, "equipo"),
    assignedToUserId: first(raw, "mecanico"),
    from: desde && ISO_DAY.test(desde) ? desde : undefined,
    to: hasta && ISO_DAY.test(hasta) ? hasta : undefined,
    q: first(raw, "q"),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: OT_PAGE_SIZE,
  }
}

/** Hay algún filtro activo distinto de la pestaña. */
export function hasWorkOrderFilters(filters: WorkOrderListFilters): boolean {
  return !!(filters.worksiteId || filters.vehicleId || filters.assignedToUserId || filters.from || filters.to || filters.q)
}

/** Número de filtros activos sin contar la búsqueda ni la pestaña. */
export function workOrderFilterCount(filters: WorkOrderListFilters): number {
  return [filters.worksiteId, filters.vehicleId, filters.assignedToUserId, filters.from, filters.to].filter(Boolean).length
}

/** Rótulos de las pestañas, en el orden del flujo. «Abiertas» es la predeterminada (sin parámetro). */
export const OT_TAB_LABELS: Record<WorkOrderTab, string> = {
  abiertas: "Abiertas",
  solicitada: "Por asignar",
  asignada: "Asignadas",
  en_ejecucion: "En taller",
  trabajo_terminado: "Por recibir",
  recepcionada: "Por conformidad",
  cerrada: "Cerradas",
  anulada: "Anuladas",
}

/** `hide`: pestañas que no aplican a quien mira (p. ej. «Por asignar» para el mecánico, que no ve OT sin asignar). */
export function buildOtTabs(counts: Record<WorkOrderTab, number>, options: { hide?: readonly WorkOrderTab[] } = {}): StageTab[] {
  return (Object.keys(OT_TAB_LABELS) as WorkOrderTab[]).filter((tab) => !options.hide?.includes(tab)).map((tab) => ({
    value: tab === "abiertas" ? "" : tab,
    label: OT_TAB_LABELS[tab],
    count: counts[tab],
    countTone: tab === "solicitada" ? "signal" : undefined,
  }))
}


import { isCivilDate } from "@/lib/validation/dates"
import type { StageTab } from "@/components/ui/stage-tabs"
import type { WorkOrderListFilters, WorkOrderTab } from "@/lib/services/mantencion/work-orders/query"

// Ojo: sólo `import type` del servicio. Este módulo lo importan componentes de cliente y el
// servicio (`query.ts`) trae la base de datos; un import de valor la metería en el bundle.
export type RawSearchParams = Record<string, string | string[] | undefined>

export const OT_PAGE_SIZE = 25

/**
 * Parámetros de la URL que son filtros (los que limpia «Limpiar filtros»; la pestaña `estado` no).
 * `repuestos` (`?repuestos=pendientes`) no tiene control en la barra (A2: ya hay seis primarios): se
 * llega por un enlace y vive como chip removible.
 */
export const OT_FILTER_PARAMS = ["faena", "equipo", "mecanico", "desde", "hasta", "q", "repuestos"] as const


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
 * La URL de la lista (`?estado=&faena=&equipo=&mecanico=&desde=&hasta=&q=&repuestos=&pagina=`)
 * como filtros del servicio. Sin `estado` rige «Por asignar» (la página redirige a
 * la primera pestaña con trabajo: `defaultOtTab`). Un valor de fecha mal formado se
 * ignora en vez de llegar a la consulta.
 */
export function parseWorkOrderQuery(raw: RawSearchParams): WorkOrderListFilters {
  const estado = first(raw, "estado")
  const desde = first(raw, "desde")
  const hasta = first(raw, "hasta")
  const page = Number.parseInt(first(raw, "pagina") ?? "1", 10)
  return {
    tab: isWorkOrderTab(estado) ? estado : "solicitada",
    worksiteId: first(raw, "faena"),
    vehicleId: first(raw, "equipo"),
    assignedToUserId: first(raw, "mecanico"),
    from: isCivilDate(desde) ? desde : undefined,
    to: isCivilDate(hasta) ? hasta : undefined,
    q: first(raw, "q"),
    partsPending: first(raw, "repuestos") === "pendientes",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: OT_PAGE_SIZE,
  }
}

/** La URL trae una pestaña válida (`?estado=`); sin ella la página elige una (`defaultOtTab`). */
export function hasExplicitTab(raw: RawSearchParams): boolean {
  return isWorkOrderTab(first(raw, "estado"))
}

/**
 * Pestañas que se ofrecen, en el orden del flujo. «Abiertas» ya no es una: era la suma de las cinco
 * primeras y repetía cada cifra (A5, auditoría 2026-11-13, M5). Sigue siendo un valor válido de `?estado=`
 * porque los tiles del tablero y del panel operacional enlazan a «todas las abiertas».
 */
export const OT_VISIBLE_TABS = ["solicitada", "asignada", "en_ejecucion", "trabajo_terminado", "recepcionada", "cerrada", "anulada"] as const satisfies readonly WorkOrderTab[]

/**
 * La pestaña con la que abre la lista cuando la URL no elige ninguna: «Por asignar» —lo primero que hace la
 * jefatura— o, si no hay nada por asignar, la primera etapa del flujo con trabajo. Con todo vacío, la primera.
 * Quien sólo ejecuta no ve «Por asignar» (`hide`).
 */
export function defaultOtTab(counts: Record<WorkOrderTab, number>, hide: readonly WorkOrderTab[] = []): WorkOrderTab {
  const flow = OT_VISIBLE_TABS.filter((tab) => tab !== "cerrada" && tab !== "anulada" && !hide.includes(tab))
  return flow.find((tab) => counts[tab] > 0) ?? flow[0] ?? "solicitada"
}

/** Hay algún filtro activo distinto de la pestaña. */
export function hasWorkOrderFilters(filters: WorkOrderListFilters): boolean {
  return !!(filters.worksiteId || filters.vehicleId || filters.assignedToUserId || filters.from || filters.to || filters.q || filters.partsPending)
}

/** Número de filtros activos sin contar la búsqueda ni la pestaña. */
export function workOrderFilterCount(filters: WorkOrderListFilters): number {
  return [filters.worksiteId, filters.vehicleId, filters.assignedToUserId, filters.from, filters.to, filters.partsPending].filter(Boolean).length
}

/** Rótulos de las pestañas, en el orden del flujo. «Abiertas» sólo se ve como aviso (`?estado=abiertas`), no como pestaña. */
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
  return OT_VISIBLE_TABS.filter((tab) => !options.hide?.includes(tab)).map((tab) => ({
    value: tab,
    label: OT_TAB_LABELS[tab],
    count: counts[tab],
    countTone: tab === "solicitada" ? "signal" : undefined,
  }))
}


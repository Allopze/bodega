"use client"

import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ANOMALY_SEVERITY_LABELS,
  ANOMALY_STATUS_LABELS,
  isOpenAnomalyCaseStatus,
  OPEN_ANOMALY_CASE_STATUSES,
} from "@/lib/combustibles/anomaly-labels"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

const ALL = "_all"
/** Parámetros que «Limpiar» quita: el período y el tipo no son filtros de esta barra. */
const FILTER_KEYS = ["faena", "severidad", "regla", "estado", "ref"] as const

/**
 * Filtros de la bandeja: faena (si la sesión ve más de una) y, cuando se mira sólo
 * los casos pendientes, la gravedad y el estado del caso (abierto, tomada o
 * reabierto). Cada filtro activo queda como chip removible bajo la barra.
 * Escriben la URL con `router.replace(…, { scroll: false })`.
 */
export function InboxFilterBar({
  worksites,
  showSeverity,
  showState,
  chips,
}: {
  worksites: { id: string; name: string }[]
  showSeverity: boolean
  /** El estado del caso sólo existe para los casos que esperan a una persona (`tipo=caso` en «Pendientes»). */
  showState: boolean
  chips: ActiveFilterChip[]
}) {
  useWorksiteFilterPresence(worksites.length > 1)
  const { searchParams, setFilter, setFilters } = useUrlFilters({ pageKey: "pagina", resetPageKeys: ["item"] })
  const faena = searchParams.get("faena") ?? ""
  const severity = searchParams.get("severidad") ?? ""
  // Un `?estado=` que no es de un caso abierto (a mano, o de un enlace viejo) se lee como «cualquiera».
  const caseState = searchParams.get("estado")
  const state = isOpenAnomalyCaseStatus(caseState) ? caseState : ""
  const showWorksites = worksites.length > 1
  if (!showWorksites && !showSeverity && !showState && chips.length === 0) return null

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setFilter(key, null)}
      onClearAll={() => setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))}
      hasActiveFilters={chips.length > 0}
    >
      {showWorksites ? (
        <Select value={faena || ALL} onValueChange={(value) => setFilter("faena", value)}>
          <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[10rem]" aria-label="Filtrar por faena">
            <SelectValue placeholder="Todas tus faenas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas tus faenas</SelectItem>
            {worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}
      {showSeverity ? (
        <Select value={severity || ALL} onValueChange={(value) => setFilter("severidad", value)}>
          <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[10rem]" aria-label="Filtrar por gravedad">
            <SelectValue placeholder="Toda gravedad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toda gravedad</SelectItem>
            {Object.entries(ANOMALY_SEVERITY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}
      {showState ? (
        <Select value={state || ALL} onValueChange={(value) => setFilter("estado", value)}>
          <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[10rem]" aria-label="Filtrar por estado del caso">
            <SelectValue placeholder="Cualquier estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Cualquier estado</SelectItem>
            {OPEN_ANOMALY_CASE_STATUSES.map((value) => <SelectItem key={value} value={value}>{ANOMALY_STATUS_LABELS[value]}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}
    </FilterToolbar>
  )
}

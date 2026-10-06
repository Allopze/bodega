"use client"

import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { OptionSelect } from "@/components/ui/option-select"
import { DatePicker } from "@/components/ui/date-picker"
import { DISPATCH_GUIDE_STATE_META } from "@/components/states/state-badge"
import { formatDate } from "@/lib/utils"
import { ALL_WORKSITES } from "../faena-scope"

interface GuideFiltersProps {
  worksites: Array<{ id: string; name: string }>
  /** Bodega propia con guías: la faena en que arranca la pantalla. */
  ownWorksiteId?: string
  current: {
    /** Estado efectivo (`""` = todos). */
    estado?: string
    /** El estado viene del valor por defecto ("Por confirmar"), no de un filtro puesto a mano. */
    estadoByDefault?: boolean
    faena?: string
    desde?: string
    hasta?: string
    q?: string
  }
}

/** Con `todos` en la URL la pantalla deja de partir en "Por confirmar". */
const ALL_STATUSES = "todos"

const STATUS_OPTIONS = Object.entries(DISPATCH_GUIDE_STATE_META).map(([value, meta]) => ({
  value,
  // "Despachada" es el estado interno; para quien confirma en bodega es lo que
  // le falta hacer.
  label: value === "dispatched" ? "Por confirmar (despachadas)" : meta.label,
}))

/**
 * Filtros de la lista (búsqueda por folio, estado, faena, rango de fechas).
 *
 * La búsqueda dejó de venir del `TopBar`: al registrar `/bodega` en
 * `ROUTES_WITH_OWN_SEARCH` — que matchea por prefijo — esta subruta perdió el
 * input de la shell del que dependía. Ahora es server-side, como el resto.
 */
export function GuideFilters({ worksites, ownWorksiteId = "", current }: GuideFiltersProps) {
  useWorksiteFilterPresence()
  const router = useRouter()
  const searchParams = useSearchParams()

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    // Cualquier cambio de filtro invalida la página actual del paginador.
    params.delete("page")
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const activeChips: ActiveFilterChip[] = []
  if (current.q) {
    activeChips.push({ key: "q", label: "Búsqueda", value: current.q, displayValue: current.q })
  }
  // El estado por defecto no es un chip: no lo puso nadie y "Limpiar filtros"
  // no lo quitaría. El selector ya dice cuál se está mirando.
  if (current.estado && !current.estadoByDefault) {
    activeChips.push({
      key: "estado",
      label: "Estado",
      value: current.estado,
      displayValue: STATUS_OPTIONS.find((option) => option.value === current.estado)?.label ?? current.estado,
    })
  }
  const faena = current.faena ?? ""
  if (faena !== ownWorksiteId) {
    const worksite = worksites.find((item) => item.id === faena)
    if (worksite) activeChips.push({ key: "faena", label: "Faena", value: worksite.id, displayValue: worksite.name })
    else if (!faena && ownWorksiteId) {
      activeChips.push({ key: "faena", label: "Faena", value: ALL_WORKSITES, displayValue: "Todas las faenas" })
    }
  }
  if (current.desde) {
    activeChips.push({ key: "desde", label: "Desde", value: current.desde, displayValue: formatDate(current.desde) })
  }
  if (current.hasta) {
    activeChips.push({ key: "hasta", label: "Hasta", value: current.hasta, displayValue: formatDate(current.hasta) })
  }

  return (
    <FilterToolbar
      activeChips={activeChips}
      onRemoveChip={(key) => setFilter(key, key === "estado" ? ALL_STATUSES : "")}
      onClearAll={() => router.replace("/bodega/guias", { scroll: false })}
      hasActiveFilters={activeChips.length > 0}
    >
      <FilterSearchInput
        param="q"
        placeholder="Buscar por folio..."
        ariaLabel="Buscar guía por folio"
        className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-56"
      />
      <OptionSelect
        aria-label="Filtrar por estado"
        className="h-11 w-full text-xs sm:h-8 sm:w-52"
        emptyLabel="Todos los estados"
        options={STATUS_OPTIONS}
        value={current.estado ?? ""}
        // "Todos" viaja explícito: sin el centinela, borrar el parámetro
        // devolvería al valor por defecto y no habría cómo ver todo.
        onValueChange={(value) => setFilter("estado", value || ALL_STATUSES)}
      />
      <OptionSelect
        aria-label="Filtrar por faena de destino"
        className="h-11 w-full text-xs sm:h-8 sm:w-52"
        emptyLabel="Todas las faenas"
        options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))}
        value={faena}
        onValueChange={(value) => setFilter("faena", value || ALL_WORKSITES)}
      />
      <DatePicker
        ariaLabel="Emitidas desde"
        placeholder="Desde"
        className="h-11 w-full text-xs sm:h-8 sm:w-36"
        value={current.desde ?? ""}
        onChange={(iso) => setFilter("desde", iso)}
      />
      <DatePicker
        ariaLabel="Emitidas hasta"
        placeholder="Hasta"
        className="h-11 w-full text-xs sm:h-8 sm:w-36"
        value={current.hasta ?? ""}
        onChange={(iso) => setFilter("hasta", iso)}
      />
    </FilterToolbar>
  )
}

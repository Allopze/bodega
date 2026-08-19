"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { OptionSelect } from "@/components/ui/option-select"
import { DatePicker } from "@/components/ui/date-picker"
import { DISPATCH_GUIDE_STATE_META } from "@/components/states/state-badge"
import { formatDate } from "@/lib/utils"

interface GuideFiltersProps {
  worksites: Array<{ id: string; name: string }>
  current: { estado?: string; faena?: string; desde?: string; hasta?: string; q?: string }
}

const STATUS_OPTIONS = Object.entries(DISPATCH_GUIDE_STATE_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}))

/**
 * Filtros de la lista (búsqueda por folio, estado, faena, rango de fechas).
 *
 * La búsqueda dejó de venir del `TopBar`: al registrar `/bodega` en
 * `ROUTES_WITH_OWN_SEARCH` — que matchea por prefijo — esta subruta perdió el
 * input de la shell del que dependía. Ahora es server-side, como el resto.
 */
export function GuideFilters({ worksites, current }: GuideFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    // Cualquier cambio de filtro invalida la página actual del paginador.
    params.delete("page")
    router.push(`?${params.toString()}`)
  }

  const activeChips: ActiveFilterChip[] = []
  if (current.q) {
    activeChips.push({ key: "q", label: "Búsqueda", value: current.q, displayValue: current.q })
  }
  if (current.estado) {
    activeChips.push({
      key: "estado",
      label: "Estado",
      value: current.estado,
      displayValue: STATUS_OPTIONS.find((option) => option.value === current.estado)?.label ?? current.estado,
    })
  }
  if (current.faena) {
    const worksite = worksites.find((item) => item.id === current.faena)
    if (worksite) activeChips.push({ key: "faena", label: "Faena", value: worksite.id, displayValue: worksite.name })
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
      onRemoveChip={(key) => setFilter(key, "")}
      onClearAll={() => router.push("/bodega/guias")}
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
        className="h-8 w-44 text-xs"
        emptyLabel="Todos los estados"
        options={STATUS_OPTIONS}
        value={current.estado ?? ""}
        onValueChange={(value) => setFilter("estado", value)}
      />
      <OptionSelect
        aria-label="Filtrar por faena de destino"
        className="h-8 w-52 text-xs"
        emptyLabel="Todas las faenas"
        options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))}
        value={current.faena ?? ""}
        onValueChange={(value) => setFilter("faena", value)}
      />
      <DatePicker
        ariaLabel="Emitidas desde"
        placeholder="Desde"
        className="h-8 w-36 text-xs"
        value={current.desde ?? ""}
        onChange={(iso) => setFilter("desde", iso)}
      />
      <DatePicker
        ariaLabel="Emitidas hasta"
        placeholder="Hasta"
        className="h-8 w-36 text-xs"
        value={current.hasta ?? ""}
        onChange={(iso) => setFilter("hasta", iso)}
      />
    </FilterToolbar>
  )
}

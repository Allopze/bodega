"use client"

import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect, type OptionSelectOption } from "@/components/ui/option-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

/** Qué falta identificar en un trabajo del historial anterior (`?vinculo=`). */
export const HISTORICAL_PENDING_OPTIONS: OptionSelectOption[] = [
  { value: "equipment", label: "Equipo sin identificar" },
  { value: "conflict", label: "Equipo con datos dudosos" },
  { value: "worksite", label: "Faena sin identificar" },
]

/**
 * Filtros del historial anterior: la búsqueda y «Por completar». Se aplican al cambiar (URL con `router.replace`,
 * sin mover el scroll), sin botón «Buscar» (A6). `?equipo=<id>` llega desde la ficha del equipo y no tiene control
 * propio: se ve como pastilla removible, igual que en la lista de órdenes de trabajo.
 */
export function HistoricalFilters() {
  const { searchParams, setFilter, setFilters, getFilter } = useUrlFilters()
  const q = searchParams.get("q") ?? ""
  const pending = getFilter("vinculo")
  const vehicleId = getFilter("equipo")

  const chips: ActiveFilterChip[] = []
  if (q) chips.push({ key: "q", label: "Búsqueda", value: q, displayValue: q })
  if (pending) chips.push({ key: "vinculo", label: "Por completar", value: pending, displayValue: String(HISTORICAL_PENDING_OPTIONS.find((option) => option.value === pending)?.label ?? pending) })
  if (vehicleId) chips.push({ key: "equipo", label: "Equipo", value: vehicleId, displayValue: "El de la ficha" })

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setFilter(key, null)}
      onClearAll={() => setFilters({ q: null, vinculo: null, equipo: null })}
    >
      <FilterSearchInput
        placeholder="Equipo, orden, faena o trabajo"
        ariaLabel="Buscar en el historial"
        className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-72"
      />
      <OptionSelect
        aria-label="Filtrar por lo que falta completar"
        className="h-11 text-xs sm:h-8"
        emptyLabel="Todo el historial"
        options={HISTORICAL_PENDING_OPTIONS}
        value={pending}
        onValueChange={(value) => setFilter("vinculo", value)}
      />
    </FilterToolbar>
  )
}

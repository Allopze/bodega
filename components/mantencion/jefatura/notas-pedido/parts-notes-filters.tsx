"use client"

import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect } from "@/components/ui/option-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

/**
 * Filtro estructurado de la bandeja: la faena, en la URL (`?faena=`, con `router.replace` y sin mover el scroll).
 * La búsqueda de texto es la de la barra superior y el estado son las pestañas (A5): aquí no hay más controles.
 * Con una sola faena en el alcance no hay nada que elegir y no se dibuja.
 */
export function PartsNotesFilters({ worksites, allWorksitesLabel }: { worksites: Array<{ id: string; name: string }>; allWorksitesLabel: string }) {
  const { setFilter, getFilter } = useUrlFilters({ pageKey: "pagina" })
  const worksiteId = getFilter("faena")
  if (worksites.length <= 1) return null

  const name = worksites.find((item) => item.id === worksiteId)?.name
  const chips: ActiveFilterChip[] = worksiteId ? [{ key: "faena", label: "Faena", value: worksiteId, displayValue: name ?? worksiteId }] : []

  return (
    <FilterToolbar activeChips={chips} onRemoveChip={(key) => setFilter(key, null)} onClearAll={() => setFilter("faena", null)}>
      <OptionSelect
        aria-label="Filtrar por faena"
        className="h-11 text-xs sm:h-8"
        emptyLabel={allWorksitesLabel}
        options={worksites.map((item) => ({ value: item.id, label: item.name }))}
        value={worksiteId}
        onValueChange={(value) => setFilter("faena", value)}
      />
    </FilterToolbar>
  )
}

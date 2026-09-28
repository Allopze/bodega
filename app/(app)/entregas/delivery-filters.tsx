"use client"

import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect } from "@/components/ui/option-select"

interface DeliveryFiltersProps {
  worksites: Array<{ id: string; name: string }>
  /** Faena ya validada contra el alcance: `""` = todas las permitidas. */
  faena: string
}

/**
 * Filtro de faena del historial de entregas, sincronizado con la URL y
 * aplicado en el servidor: el historial está paginado, así que filtrar en
 * memoria sólo alcanzaría a la página en pantalla. La búsqueda de texto sigue
 * viniendo del TopBar.
 */
export function DeliveryFilters({ worksites, faena }: DeliveryFiltersProps) {
  useWorksiteFilterPresence()
  const router = useRouter()
  const searchParams = useSearchParams()

  function setFaena(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set("faena", value)
    else params.delete("faena")
    // Cambiar de faena invalida la página actual del paginador.
    params.delete("page")
    const qs = params.toString()
    router.replace(qs ? `/entregas?${qs}` : "/entregas", { scroll: false })
  }

  const activeChips: ActiveFilterChip[] = []
  const worksite = worksites.find((item) => item.id === faena)
  if (worksite) activeChips.push({ key: "faena", label: "Faena", value: worksite.id, displayValue: worksite.name })

  return (
    <FilterToolbar
      activeChips={activeChips}
      onRemoveChip={() => setFaena("")}
      onClearAll={() => setFaena("")}
      hasActiveFilters={activeChips.length > 0}
    >
      <OptionSelect
        aria-label="Filtrar por faena"
        className="h-11 w-full text-xs sm:h-8 sm:w-52"
        emptyLabel="Todas las faenas"
        options={worksites.map((item) => ({ value: item.id, label: item.name }))}
        value={faena}
        onValueChange={setFaena}
      />
    </FilterToolbar>
  )
}

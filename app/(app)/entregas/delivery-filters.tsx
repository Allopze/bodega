"use client"

import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { OptionSelect } from "@/components/ui/option-select"

interface DeliveryFiltersProps {
  worksites: Array<{ id: string; name: string }>
  /** Faena ya validada contra el alcance: `""` = todas las permitidas. */
  faena: string
  /** Búsqueda de texto ya normalizada por el servidor: `""` = sin búsqueda. */
  q?: string
}

/**
 * Filtro de faena del historial de entregas, sincronizado con la URL y
 * aplicado en el servidor: el historial está paginado, así que filtrar en
 * memoria sólo alcanzaría a la página en pantalla. La búsqueda de texto sigue
 * viniendo del TopBar.
 *
 * BOD-01 (auditoría 2026-10-05): la búsqueda de texto ya NO viene del TopBar.
 * Ese input filtraba sólo las 25 filas de la página actual y "Eduardo" (página
 * 3) daba "Sin entregas". `/entregas` está en `ROUTES_WITH_OWN_SEARCH` y la
 * búsqueda es `?q=`, resuelta en SQL por `history-search.ts`.
 */
export function DeliveryFilters({ worksites, faena, q = "" }: DeliveryFiltersProps) {
  useWorksiteFilterPresence()
  const router = useRouter()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    // Cambiar un filtro invalida la página actual del paginador.
    params.delete("page")
    const qs = params.toString()
    router.replace(qs ? `/entregas?${qs}` : "/entregas", { scroll: false })
  }
  const setFaena = (value: string) => setParam("faena", value)

  const activeChips: ActiveFilterChip[] = []
  if (q) activeChips.push({ key: "q", label: "Búsqueda", value: q, displayValue: q })
  const worksite = worksites.find((item) => item.id === faena)
  if (worksite) activeChips.push({ key: "faena", label: "Faena", value: worksite.id, displayValue: worksite.name })

  return (
    <FilterToolbar
      activeChips={activeChips}
      onRemoveChip={(key) => setParam(key, "")}
      onClearAll={() => router.replace("/entregas", { scroll: false })}
      hasActiveFilters={activeChips.length > 0}
    >
      <FilterSearchInput
        param="q"
        placeholder="Buscar trabajador, RUT, código o producto..."
        ariaLabel="Buscar en el historial de entregas"
        className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-72"
      />
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

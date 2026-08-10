"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect } from "@/components/ui/option-select"
import { DatePicker } from "@/components/ui/date-picker"
import { DISPATCH_GUIDE_STATE_META } from "@/components/states/state-badge"
import { formatDate } from "@/lib/utils"

interface GuideFiltersProps {
  worksites: Array<{ id: string; name: string }>
  current: { estado?: string; faena?: string; desde?: string; hasta?: string }
}

const STATUS_OPTIONS = Object.entries(DISPATCH_GUIDE_STATE_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}))

/**
 * Filtros estructurados de la lista (estado, faena, rango de fechas).
 *
 * La búsqueda por número la aporta el buscador del `TopBar`, que el `DataTable`
 * consume solo: acá no va otro input de texto (regla de search-architecture).
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

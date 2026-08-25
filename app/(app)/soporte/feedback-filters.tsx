"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { OptionSelect } from "@/components/ui/option-select"
import type { FeedbackListQuery } from "@/lib/services/feedback-list-query"

const STATUS_OPTIONS = [
  { value: "abierto", label: "Abierto" },
  { value: "en_progreso", label: "En progreso" },
  { value: "resuelto", label: "Resuelto" },
  { value: "descartado", label: "Descartado" },
]
const TYPE_OPTIONS = [
  { value: "bug", label: "Error" },
  { value: "consulta", label: "Consulta" },
  { value: "sugerencia", label: "Sugerencia" },
]
const PRIORITY_OPTIONS = [
  { value: "baja", label: "Baja" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica" },
]

export function FeedbackFilters({ current }: { current: FeedbackListQuery }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete("page")
    const query = params.toString()
    router.replace(query ? `/soporte?${query}` : "/soporte", { scroll: false })
  }

  const chips: ActiveFilterChip[] = []
  if (current.q) chips.push({ key: "q", label: "Búsqueda", value: current.q, displayValue: current.q })
  for (const [key, value, label, options] of [
    ["estado", current.estado, "Estado", STATUS_OPTIONS],
    ["tipo", current.tipo, "Tipo", TYPE_OPTIONS],
    ["prioridad", current.priority, "Prioridad", PRIORITY_OPTIONS],
  ] as const) {
    const option = options.find((item) => item.value === value)
    if (option) chips.push({ key, label, value: option.value, displayValue: option.label })
  }

  return (
    <FilterToolbar
      activeChips={chips}
      hasActiveFilters={chips.length > 0}
      onRemoveChip={(key) => {
        setFilter(key, "")
      }}
      onClearAll={() => router.replace("/soporte", { scroll: false })}
    >
      <FilterSearchInput
        param="q"
        placeholder="Buscar título o descripción..."
        ariaLabel="Buscar reportes de soporte"
      />
      <OptionSelect
        aria-label="Filtrar por estado"
        className="h-11 w-full text-xs sm:h-8 sm:w-40"
        emptyLabel="Todos los estados"
        options={STATUS_OPTIONS}
        value={current.estado ?? ""}
        onValueChange={(value) => setFilter("estado", value)}
      />
      <OptionSelect
        aria-label="Filtrar por tipo"
        className="h-11 w-full text-xs sm:h-8 sm:w-40"
        emptyLabel="Todos los tipos"
        options={TYPE_OPTIONS}
        value={current.tipo ?? ""}
        onValueChange={(value) => setFilter("tipo", value)}
      />
      <OptionSelect
        aria-label="Filtrar por prioridad"
        className="h-11 w-full text-xs sm:h-8 sm:w-40"
        emptyLabel="Todas las prioridades"
        options={PRIORITY_OPTIONS}
        value={current.priority ?? ""}
        onValueChange={(value) => setFilter("prioridad", value)}
      />
    </FilterToolbar>
  )
}

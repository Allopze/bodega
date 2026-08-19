"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { OptionSelect } from "@/components/ui/option-select"
import { DatePicker } from "@/components/ui/date-picker"
import { formatDate } from "@/lib/utils"

const KIND_OPTIONS = [
  { value: "ajuste",     label: "Ajustes" },
  { value: "desecho",    label: "Bajas" },
  { value: "devolucion", label: "Devoluciones" },
  { value: "conteo",     label: "Conteos físicos" },
]

export function DocumentsFilters({
  worksites,
  current,
}: {
  worksites: Array<{ id: string; name: string }>
  current: { q?: string; faena?: string; tipo?: string; desde?: string; hasta?: string }
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete("page")
    // Un filtro nuevo invalida el documento resaltado por el enlace anterior.
    params.delete("doc")
    const qs = params.toString()
    router.replace(qs ? `/bodega/documentos?${qs}` : "/bodega/documentos", { scroll: false })
  }

  const chips: ActiveFilterChip[] = []
  if (current.q) chips.push({ key: "q", label: "Búsqueda", value: current.q, displayValue: current.q })
  if (current.tipo) {
    const option = KIND_OPTIONS.find((item) => item.value === current.tipo)
    if (option) chips.push({ key: "tipo", label: "Tipo", value: current.tipo, displayValue: option.label })
  }
  if (current.faena) {
    const worksite = worksites.find((item) => item.id === current.faena)
    if (worksite) chips.push({ key: "faena", label: "Faena", value: worksite.id, displayValue: worksite.name })
  }
  if (current.desde) chips.push({ key: "desde", label: "Desde", value: current.desde, displayValue: formatDate(current.desde) })
  if (current.hasta) chips.push({ key: "hasta", label: "Hasta", value: current.hasta, displayValue: formatDate(current.hasta) })

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setFilter(key, "")}
      onClearAll={() => router.replace("/bodega/documentos", { scroll: false })}
      hasActiveFilters={chips.length > 0}
    >
      <FilterSearchInput
        param="q"
        placeholder="Buscar folio, producto o motivo..."
        ariaLabel="Buscar documento de bodega"
        className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-64"
      />
      <OptionSelect
        aria-label="Filtrar por tipo de documento"
        className="h-11 w-full text-xs sm:h-8 sm:w-48"
        emptyLabel="Todos los tipos"
        options={KIND_OPTIONS}
        value={current.tipo ?? ""}
        onValueChange={(value) => setFilter("tipo", value)}
      />
      <OptionSelect
        aria-label="Filtrar por faena"
        className="h-11 w-full text-xs sm:h-8 sm:w-52"
        emptyLabel="Todas las faenas"
        options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))}
        value={current.faena ?? ""}
        onValueChange={(value) => setFilter("faena", value)}
      />
      <DatePicker
        ariaLabel="Documentos desde"
        placeholder="Desde"
        className="h-11 w-full text-xs sm:h-8 sm:w-36"
        value={current.desde ?? ""}
        onChange={(iso) => setFilter("desde", iso)}
      />
      <DatePicker
        ariaLabel="Documentos hasta"
        placeholder="Hasta"
        className="h-11 w-full text-xs sm:h-8 sm:w-36"
        value={current.hasta ?? ""}
        onChange={(iso) => setFilter("hasta", iso)}
      />
    </FilterToolbar>
  )
}

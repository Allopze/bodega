"use client"

import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { OptionSelect } from "@/components/ui/option-select"
import { DatePicker } from "@/components/ui/date-picker"
import { formatDate } from "@/lib/utils"
import { ALL_WORKSITES } from "../faena-scope"

const KIND_OPTIONS = [
  { value: "ajuste",     label: "Ajustes" },
  { value: "desecho",    label: "Bajas" },
  { value: "devolucion", label: "Devoluciones" },
  { value: "conteo",     label: "Conteos físicos" },
]

export function DocumentsFilters({
  worksites,
  ownWorksiteId = "",
  current,
}: {
  worksites: Array<{ id: string; name: string }>
  /** Bodega propia: la faena en que arranca la pantalla (misma regla que Stock). */
  ownWorksiteId?: string
  current: { q?: string; faena?: string; tipo?: string; desde?: string; hasta?: string }
}) {
  useWorksiteFilterPresence()
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
  // Mismo criterio que en Bodega: el chip anuncia salirse de la bodega propia
  // y quitarlo vuelve a ella; estando en ella no hay nada que anunciar.
  const faena = current.faena ?? ""
  if (faena !== ownWorksiteId) {
    const worksite = worksites.find((item) => item.id === faena)
    if (worksite) chips.push({ key: "faena", label: "Faena", value: worksite.id, displayValue: worksite.name })
    else if (!faena && ownWorksiteId) {
      chips.push({ key: "faena", label: "Faena", value: ALL_WORKSITES, displayValue: "Todas las faenas" })
    }
  }
  if (current.desde) chips.push({ key: "desde", label: "Desde", value: current.desde, displayValue: formatDate(current.desde) })
  if (current.hasta) chips.push({ key: "hasta", label: "Hasta", value: current.hasta, displayValue: formatDate(current.hasta) })

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setFilter(key, "")}
      // Limpiar vuelve al alcance por defecto, no a "todas".
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
        value={faena}
        onValueChange={(value) => setFilter("faena", value || (ownWorksiteId ? ALL_WORKSITES : ""))}
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

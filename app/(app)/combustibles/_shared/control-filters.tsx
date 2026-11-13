"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { WorksiteSelect } from "@/components/ui/worksite-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

const ALL = "_all"
const RESET_PAGE_KEYS = ["cargas"]

interface Option { id: string; name: string }

export interface ControlFiltersProps {
  worksites: Option[]
  /** Si se pasa, aparece el selector de mandante (vistas C). */
  mandantes?: Option[]
  /** Parámetros propios de la vista que también deben borrarse al quitar los filtros. */
  extraKeys?: string[]
  /** Filtros propios de la vista (unidad, medio, equipo), en la misma fila. */
  children?: React.ReactNode
  /** Chips de los filtros propios de la vista (los de faena y mandante los arma el componente). */
  extraChips?: ActiveFilterChip[]
  /** Filtros secundarios, tras «Más filtros (N)». `secondaryActive` es cuántos están puestos. */
  overflowFilters?: React.ReactNode
  secondaryActive?: number
  overflowTitle?: string
  overflowDescription?: string
}

/**
 * Filtros del control: faena, mandante y los propios de la vista, todo en la
 * URL para poder compartirla. Es el `FilterToolbar` compartido (el mismo de
 * Cargas y de Facturas y pagos): chips removibles bajo la barra y «Más filtros
 * (N)» para lo secundario. El período no vive aquí —lo elige `FuelPeriodControl`
 * en la cabecera y viaja por todo el módulo—, así que quitar los filtros no lo
 * toca.
 */
export function ControlFilters({
  worksites,
  mandantes,
  extraKeys = [],
  children,
  extraChips = [],
  overflowFilters,
  secondaryActive = 0,
  overflowTitle,
  overflowDescription,
}: ControlFiltersProps) {
  const searchParams = useSearchParams()
  // `cargas` es la página del detalle de cargas en las vistas de rendimiento:
  // cambiar la faena o el mandante la vuelve a la primera.
  const { setFilter, setFilters, isPending } = useUrlFilters({ pageKey: "pagina", resetPageKeys: RESET_PAGE_KEYS })

  const worksiteId = searchParams.get("faena") ?? ""
  const mandanteId = searchParams.get("mandante") ?? ""
  const managedKeys = ["faena", "mandante", ...extraKeys]
  const hasFilters = managedKeys.some((key) => searchParams.has(key))

  const chips: ActiveFilterChip[] = []
  if (worksiteId) chips.push({ key: "faena", label: "Faena", value: worksiteId, displayValue: worksites.find((item) => item.id === worksiteId)?.name ?? worksiteId })
  if (mandanteId && mandantes) chips.push({ key: "mandante", label: "Mandante", value: mandanteId, displayValue: mandantes.find((item) => item.id === mandanteId)?.name ?? mandanteId })
  chips.push(...extraChips)

  return (
    <div aria-busy={isPending || undefined}>
      <FilterToolbar
        className="mb-6"
        activeChips={chips}
        onRemoveChip={(key) => setFilter(key, null)}
        onClearAll={() => setFilters(Object.fromEntries(managedKeys.map((key) => [key, null])))}
        hasActiveFilters={hasFilters}
        activeCount={secondaryActive}
        overflowFilters={overflowFilters}
        overflowTitle={overflowTitle}
        overflowDescription={overflowDescription}
      >
        <WorksiteSelect
          worksites={worksites}
          value={worksiteId}
          onChange={(value) => setFilter("faena", value || null)}
          triggerClassName="w-56"
        />
        {mandantes ? (
          <Select value={mandanteId || ALL} onValueChange={(value) => setFilter("mandante", value === ALL ? null : value)}>
            <SelectTrigger className="w-56" aria-label="Mandante">
              <SelectValue placeholder="Todos los mandantes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los mandantes</SelectItem>
              {mandantes.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
        {children}
      </FilterToolbar>
    </div>
  )
}

"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
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
  /** Parámetros propios de la vista que también deben borrarse al limpiar. */
  extraKeys?: string[]
  /** Filtros propios de la vista (unidad, medio, equipo), en la misma fila. */
  children?: React.ReactNode
}

/**
 * Filtros del control: faena, mandante y los propios de la vista, todo en la
 * URL para poder compartirla. El período ya no vive aquí: lo elige
 * `FuelPeriodControl` en la cabecera y viaja por todo el módulo, así que
 * «Limpiar filtros» no lo toca.
 */
export function ControlFilters({ worksites, mandantes, extraKeys = [], children }: ControlFiltersProps) {
  const searchParams = useSearchParams()
  // `cargas` es la página del detalle de cargas en las vistas de rendimiento:
  // cambiar la faena o el mandante la vuelve a la primera.
  const { setFilter, setFilters, isPending } = useUrlFilters({ pageKey: "pagina", resetPageKeys: RESET_PAGE_KEYS })

  const worksiteId = searchParams.get("faena") ?? ""
  const mandanteId = searchParams.get("mandante") ?? ""
  const managedKeys = ["faena", "mandante", ...extraKeys]
  const hasFilters = managedKeys.some((key) => searchParams.has(key))

  function clearAll() {
    setFilters(Object.fromEntries(managedKeys.map((key) => [key, null])))
  }

  return (
    <div className="mb-6 flex flex-wrap items-end gap-2.5" aria-busy={isPending || undefined}>
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
      {hasFilters ? (
        <Button type="button" variant="ghost" size="sm" onClick={clearAll} className="min-h-10">
          Limpiar filtros
        </Button>
      ) : null}
    </div>
  )
}

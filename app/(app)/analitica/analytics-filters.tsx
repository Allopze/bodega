"use client"

import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import * as React from "react"
import { X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { PeriodControl } from "@/components/ui/period-control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import type { AnalyticsFilters } from "@/lib/services/analytics"

interface Option {
  id: string
  name: string
}

/**
 * Filtros de Analítica: el período (`PeriodControl`, mismo control que el resto de
 * la plataforma) y tres selectores. Todo aplica al cambiar —`router.replace` sin
 * mover el scroll— y no hay botón «Filtrar»: antes hacía falta elegir, y además
 * pulsar, para que un cambio surtiera efecto, y quien olvidaba el botón miraba
 * cifras que ya no correspondían a lo elegido.
 */
export function AnalyticsFiltersBar({
  filters,
  defaultRange,
  worksites,
  suppliers,
  vehicles,
}: {
  filters: Required<Pick<AnalyticsFilters, "fromDate" | "toDate">> & Omit<AnalyticsFilters, "fromDate" | "toDate">
  /** El rango que la pantalla usa sin parámetros: lo que «Volver a …» restablece. */
  defaultRange: { from: string; to: string }
  worksites: Option[]
  suppliers: Option[]
  vehicles: Array<Option & { plate?: string }>
}) {
  useWorksiteFilterPresence()
  const { setFilter, clearFilters, isPending } = useUrlFilters()
  const periodChanged = filters.fromDate !== defaultRange.from || filters.toDate !== defaultRange.to
  const hasActiveFilters = periodChanged || Boolean(filters.worksiteId || filters.supplierId || filters.vehicleId)

  return (
    <section
      className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
      aria-label="Filtros de analítica"
      aria-busy={isPending || undefined}
    >
      {/* `grid-cols-1` (= `minmax(0, 1fr)`): con la pista implícita `auto`
          el valor de un `Select` crecía hasta su min-content y la columna se
          salía 141 px del pozo a 320 px. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[auto_1fr_1fr_1fr_auto] lg:items-end">
        <div className="grid gap-1.5">
          {/* Rótulo visual: el grupo ya se llama «Período» para quien usa lector de pantalla. */}
          <span className="text-xs font-medium text-[var(--color-text-subtle)]" aria-hidden="true">Período</span>
          <PeriodControl
            mode="range"
            from={filters.fromDate}
            to={filters.toDate}
            defaultRange={{ ...defaultRange, label: "los últimos 30 días" }}
            className="justify-self-start"
          />
        </div>
        <FilterSelect
          id="analytics-worksite"
          label="Faena"
          ariaLabel="Filtrar por faena"
          allLabel="Todas"
          value={filters.worksiteId ?? ""}
          options={worksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))}
          onChange={(value) => setFilter("faena", value)}
        />
        <FilterSelect
          id="analytics-supplier"
          label="Proveedor OC"
          ariaLabel="Filtrar por proveedor de orden de compra"
          allLabel="Todos"
          value={filters.supplierId ?? ""}
          options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
          onChange={(value) => setFilter("proveedor", value)}
        />
        <FilterSelect
          id="analytics-vehicle"
          label="Vehículo"
          ariaLabel="Filtrar por vehículo"
          allLabel="Todos"
          value={filters.vehicleId ?? ""}
          options={vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.plate ?? vehicle.name }))}
          onChange={(value) => setFilter("vehiculo", value)}
        />
        {hasActiveFilters ? (
          <div className="flex lg:justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => clearFilters()}>
              <X className="h-4 w-4" aria-hidden="true" />
              Limpiar filtros
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Un selector que aplica al elegir. Muestra de inmediato lo elegido —la URL tarda
 * lo que tarda el servidor en responder— y vuelve a seguir a la URL cuando esta
 * cambia (limpiar filtros, botón atrás).
 */
function FilterSelect({
  id,
  label,
  ariaLabel,
  allLabel,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  ariaLabel: string
  allLabel: string
  /** Valor vigente en la URL; `""` es «todos». */
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  const [urlValue, setUrlValue] = React.useState(value)
  const [shown, setShown] = React.useState(value)
  if (urlValue !== value) {
    setUrlValue(value)
    setShown(value)
  }

  return (
    <div className="grid gap-1.5">
      <label className="text-xs font-medium text-[var(--color-text-subtle)]" htmlFor={id}>{label}</label>
      <Select
        value={shown || "_all"}
        onValueChange={(next) => {
          const chosen = next === "_all" ? "" : next
          setShown(chosen)
          onChange(chosen)
        }}
      >
        <SelectTrigger id={id} aria-label={ariaLabel}>
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

const ALL = "_all"

/**
 * Selector de una lista que vive en la URL (`?<param>=<id>`): cambiarlo vuelve a
 * la página 1 y no mueve el scroll (`useUrlFilters` navega con `router.replace`
 * y `scroll: false`). Sirve para el equipo del detalle de sellos y el producto de
 * los estanques.
 */
export function UrlSelect({
  param,
  options,
  value,
  ariaLabel,
  allLabel,
  className,
  searchable = true,
}: {
  param: string
  options: Array<{ id: string; label: string }>
  value: string
  ariaLabel: string
  /** Texto de «sin selección». Omitirlo si siempre hay una opción elegida. */
  allLabel?: string
  className?: string
  searchable?: boolean
}) {
  const { setFilter, isPending } = useUrlFilters({ pageKey: "pagina" })
  return (
    <Select value={value || (allLabel ? ALL : "")} onValueChange={(next) => setFilter(param, next === ALL ? null : next)} searchable={searchable}>
      <SelectTrigger aria-label={ariaLabel} aria-busy={isPending || undefined} className={className ?? "w-64"}>
        <SelectValue placeholder={allLabel ?? "Elegir"} />
      </SelectTrigger>
      <SelectContent>
        {allLabel ? <SelectItem value={ALL}>{allLabel}</SelectItem> : null}
        {options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

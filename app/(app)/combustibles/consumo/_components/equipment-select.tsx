"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

const ALL = "_all"

/** Selector de equipo que vive en la URL (`?equipo=<id>`); cambiarlo vuelve a la página 1. */
export function EquipmentSelect({
  options,
  value,
  ariaLabel,
  allLabel,
  className,
}: {
  options: Array<{ id: string; label: string }>
  value: string
  ariaLabel: string
  /** Texto de «sin selección». Omitirlo si siempre hay un equipo elegido. */
  allLabel?: string
  className?: string
}) {
  const { setFilter, isPending } = useUrlFilters({ pageKey: "pagina" })
  return (
    <Select value={value || (allLabel ? ALL : "")} onValueChange={(next) => setFilter("equipo", next === ALL ? null : next)} searchable>
      <SelectTrigger aria-label={ariaLabel} aria-busy={isPending || undefined} className={className ?? "w-64"}>
        <SelectValue placeholder={allLabel ?? "Elegir equipo"} />
      </SelectTrigger>
      <SelectContent>
        {allLabel ? <SelectItem value={ALL}>{allLabel}</SelectItem> : null}
        {options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

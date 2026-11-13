"use client"

import * as React from "react"
import { useWorksiteFilterPresence } from "@/components/layout/header-context"
import { Checkbox } from "@/components/ui/checkbox"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"

const ALL = "_all"
const PAGE_KEYS = ["pagina", "page"]

interface Option { value: string; label: string }

function SelectFilter({ value, onValue, allLabel, ariaLabel, options }: { value: string; onValue: (next: string) => void; allLabel: string; ariaLabel: string; options: Option[] }) {
  return (
    <Select value={value || ALL} onValueChange={onValue}>
      <SelectTrigger className="h-11 w-full text-xs sm:h-8 sm:w-auto sm:min-w-[9rem]" aria-label={ariaLabel}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/**
 * Filtros de «Tarjetas Copec»: buscar, faena, proveedor y
 * «sólo patentes sin vincular». El período vive en la cabecera. Cada filtro
 * activo tiene su chip; se aplican al instante con `router.replace`.
 */
export function TarjetasFilters({ worksites, suppliers }: { worksites: Option[]; suppliers: Option[] }) {
  useWorksiteFilterPresence(worksites.length > 0)
  const { searchParams, setFilter, setFilters, isPending } = useUrlFilters({ resetPageKeys: PAGE_KEYS })
  const get = (key: string) => searchParams.get(key) ?? ""
  const unlinkedOnly = get("sin_vincular") === "si"

  const chips: ActiveFilterChip[] = []
  if (get("faena")) chips.push({ key: "faena", label: "Faena", value: get("faena"), displayValue: worksites.find((item) => item.value === get("faena"))?.label ?? get("faena") })
  // `proveedor` es el nombre de antes de este filtro (`?vista=registros&proveedor=`): se lee igual.
  const supplier = get("fuente") || get("proveedor")
  if (supplier) chips.push({ key: get("fuente") ? "fuente" : "proveedor", label: "Proveedor", value: supplier, displayValue: suppliers.find((item) => item.value === supplier)?.label ?? supplier })
  if (unlinkedOnly) chips.push({ key: "sin_vincular", label: "Patentes", value: "si", displayValue: "Sólo sin vincular" })
  if (get("patente")) chips.push({ key: "patente", label: "Búsqueda", value: get("patente"), displayValue: get("patente") })

  return (
    <div aria-busy={isPending}>
      <FilterToolbar
        hasActiveFilters={chips.length > 0}
        activeChips={chips}
        onRemoveChip={(key) => setFilter(key, null)}
        onClearAll={() => setFilters({ faena: null, fuente: null, sin_vincular: null, patente: null, proveedor: null })}
      >
        <FilterSearchInput param="patente" placeholder="Buscar patente o equipo…" ariaLabel="Buscar patente o equipo" pageKeys={PAGE_KEYS} className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-64" />
        <SelectFilter value={get("faena")} onValue={(next) => setFilter("faena", next)} allLabel="Todas tus faenas" ariaLabel="Filtrar por faena" options={worksites} />
        <SelectFilter value={supplier} onValue={(next) => setFilters({ fuente: next === ALL ? null : next, proveedor: null })} allLabel="Todos los proveedores" ariaLabel="Filtrar por proveedor" options={suppliers} />
        <Checkbox id="tarjetas-sin-vincular" label="Sólo patentes sin vincular" checked={unlinkedOnly} onChange={(event) => setFilter("sin_vincular", event.target.checked ? "si" : null)} />
      </FilterToolbar>
    </div>
  )
}

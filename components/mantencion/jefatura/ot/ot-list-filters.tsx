"use client"

import { DatePicker } from "@/components/ui/date-picker"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect, type OptionSelectOption } from "@/components/ui/option-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import type { WorkOrderFilterOptions } from "@/lib/services/mantencion/work-orders/query"
import { formatDate } from "@/lib/utils"
import { OT_FILTER_PARAMS } from "./ot-filters"

const BAR_SELECT_CLASS = "h-11 text-xs sm:h-8"

export interface OtFilterEquipment {
  id: string
  label: string
}

/**
 * Filtros de la lista de OT (A2): cinco primarios —búsqueda, faena, mecánico,
 * desde y hasta— con una pastilla removible por cada filtro activo (también
 * «Equipo» y «Repuestos: pendientes», que no tienen control propio). El estado NO
 * está aquí: son las pestañas sobre la tabla (A5). Todo vive en la URL
 * (`router.replace`, sin mover el scroll) y la búsqueda es del servidor, por eso
 * la ruta está en `ROUTES_WITH_OWN_SEARCH` y este input va rotulado.
 *
 * Un solo campo de búsqueda (auditoría 2026-11-13, M5): el combobox «Equipo» se
 * fue porque la búsqueda ya encuentra por código y patente del equipo, y dos
 * campos con lupa no dejaban claro cuál usar. `?equipo=<id>` sigue siendo válido
 * (la ficha del equipo enlaza así a sus órdenes) y se ve como pastilla removible.
 */
export function OtListFilters({ options, equipment }: { options: WorkOrderFilterOptions; equipment: OtFilterEquipment[] }) {
  const { searchParams, setFilter, setFilters, getFilter } = useUrlFilters({ pageKey: "pagina" })
  const showWorksite = options.worksites.length > 1

  const worksiteOptions: OptionSelectOption[] = options.worksites.map((item) => ({ value: item.id, label: item.name }))
  const mechanicOptions: OptionSelectOption[] = options.mechanics.map((item) => ({ value: item.id, label: item.name }))

  const worksiteId = getFilter("faena")
  const vehicleId = getFilter("equipo")
  const mechanicId = getFilter("mecanico")
  const from = getFilter("desde")
  const to = getFilter("hasta")
  const q = searchParams.get("q") ?? ""
  const partsPending = getFilter("repuestos") === "pendientes"

  const chips: ActiveFilterChip[] = []
  const add = (key: string, label: string, value: string, displayValue: string | undefined) => {
    if (value) chips.push({ key, label, value, displayValue: displayValue ?? value })
  }
  add("faena", "Faena", worksiteId, options.worksites.find((item) => item.id === worksiteId)?.name)
  add("equipo", "Equipo", vehicleId, equipment.find((item) => item.id === vehicleId)?.label)
  add("mecanico", "Mecánico", mechanicId, options.mechanics.find((item) => item.id === mechanicId)?.name)
  add("desde", "Desde", from, from ? formatDate(from) : undefined)
  add("hasta", "Hasta", to, to ? formatDate(to) : undefined)
  add("q", "Búsqueda", q, q)
  // Sin control propio (A2): llega por el enlace del tile de OT o de la ficha y se quita desde el chip.
  add("repuestos", "Repuestos", partsPending ? "pendientes" : "", "pendientes")

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setFilter(key, null)}
      onClearAll={() => setFilters(Object.fromEntries(OT_FILTER_PARAMS.map((key) => [key, null])))}
    >
      <FilterSearchInput
        param="q"
        pageKeys={["pagina"]}
        placeholder="Folio, equipo (código o patente) o solicitante"
        ariaLabel="Buscar órdenes de trabajo por folio, equipo o solicitante"
        className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-72"
      />
      {showWorksite && (
        <OptionSelect aria-label="Filtrar por faena" className={BAR_SELECT_CLASS} emptyLabel="Todas las faenas" options={worksiteOptions} value={worksiteId} onValueChange={(v) => setFilter("faena", v)} />
      )}
      <OptionSelect aria-label="Filtrar por mecánico" className={BAR_SELECT_CLASS} emptyLabel="Todos los mecánicos" options={mechanicOptions} value={mechanicId} onValueChange={(v) => setFilter("mecanico", v)} />
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
        <div className="min-w-0 sm:w-32">
          <DatePicker ariaLabel="Desde" placeholder="Desde" value={from} max={to || undefined} onChange={(iso) => setFilter("desde", iso)} />
        </div>
        <div className="min-w-0 sm:w-32">
          <DatePicker ariaLabel="Hasta" placeholder="Hasta" value={to} min={from || undefined} onChange={(iso) => setFilter("hasta", iso)} />
        </div>
      </div>
    </FilterToolbar>
  )
}

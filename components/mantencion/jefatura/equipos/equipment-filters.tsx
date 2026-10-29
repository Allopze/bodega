"use client"

import { useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect, type OptionSelectOption } from "@/components/ui/option-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { EQUIPMENT_STATE_LABEL } from "@/lib/mantencion/format"
import { MANT_EQUIPMENT_STATES } from "@/lib/mantencion/types"
import { NO_SCHEDULE, parseEquipmentListFilters } from "@/lib/services/mantencion/equipment-list"

const SELECT_CLASS = "h-11 w-full text-xs sm:h-8 sm:w-44"

const STATE_OPTIONS: OptionSelectOption[] = MANT_EQUIPMENT_STATES.map((value) => ({ value, label: EQUIPMENT_STATE_LABEL[value] }))

export interface EquipmentFilterOptions {
  worksites: OptionSelectOption[]
  types: OptionSelectOption[]
  schedules: OptionSelectOption[]
}

/** Todo lo que la barra escribe en la URL: «Limpiar filtros» los quita todos. */
const FILTER_KEYS = ["faena", "tipo", "pauta", "estado", "bajas"] as const

/**
 * Filtros estructurados de «Equipos» (A2): faena, tipo, pauta y estado, más la
 * casilla «Mostrar dados de baja». La búsqueda de texto NO está aquí: la pone el
 * buscador de la barra superior, que filtra la lista ya cargada. Todo vive en la
 * URL (`router.replace`, sin mover el scroll), así que el panel puede enlazar con
 * `?estado=vencida` y el filtro sobrevive a recargar la página.
 */
export function EquipmentFilters({ options }: { options: EquipmentFilterOptions }) {
  const { searchParams, setFilter, setFilters, getFilter } = useUrlFilters()
  const filters = parseEquipmentListFilters(Object.fromEntries(searchParams.entries()))
  // La casilla responde al toque antes de que termine la navegación de la URL; si la URL cambia
  // por otro camino (quitar el chip, «Limpiar»), se vuelve a alinear con ella.
  const [includeRetired, setIncludeRetired] = useState(filters.includeRetired)
  const [urlIncludeRetired, setUrlIncludeRetired] = useState(filters.includeRetired)
  if (urlIncludeRetired !== filters.includeRetired) {
    setUrlIncludeRetired(filters.includeRetired)
    setIncludeRetired(filters.includeRetired)
  }
  const labelOf = (list: OptionSelectOption[], value: string | undefined) => String(list.find((item) => item.value === value)?.label ?? value ?? "")

  const chips: ActiveFilterChip[] = []
  const add = (key: string, label: string, value: string | undefined, displayValue: string) => {
    if (value) chips.push({ key, label, value, displayValue })
  }
  add("faena", "Faena", filters.worksiteId, labelOf(options.worksites, filters.worksiteId))
  add("tipo", "Tipo", filters.typeId, labelOf(options.types, filters.typeId))
  add("pauta", "Pauta", filters.scheduleId, filters.scheduleId === NO_SCHEDULE ? "Sin pauta" : labelOf(options.schedules, filters.scheduleId))
  add("estado", "Estado", filters.state, labelOf(STATE_OPTIONS, filters.state))
  if (filters.includeRetired && filters.state !== "baja") chips.push({ key: "bajas", label: "Incluye", value: "1", displayValue: "dados de baja" })

  const scheduleOptions: OptionSelectOption[] = [...options.schedules, { value: NO_SCHEDULE, label: "Sin pauta" }]

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => setFilter(key, null)}
      onClearAll={() => setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))}
    >
      <OptionSelect aria-label="Filtrar por faena" className={SELECT_CLASS} emptyLabel="Todas las faenas" options={options.worksites} value={getFilter("faena")} onValueChange={(v) => setFilter("faena", v)} />
      <OptionSelect aria-label="Filtrar por tipo de equipo" className={SELECT_CLASS} emptyLabel="Todos los tipos" options={options.types} value={getFilter("tipo")} onValueChange={(v) => setFilter("tipo", v)} />
      <OptionSelect aria-label="Filtrar por pauta" className={SELECT_CLASS} emptyLabel="Todas las pautas" options={scheduleOptions} value={getFilter("pauta")} onValueChange={(v) => setFilter("pauta", v)} />
      <OptionSelect aria-label="Filtrar por estado de mantención" className={SELECT_CLASS} emptyLabel="Todos los estados" options={STATE_OPTIONS} value={getFilter("estado")} onValueChange={(v) => setFilter("estado", v)} />
      <Checkbox
        id="eq-f-bajas"
        label="Mostrar dados de baja"
        checked={includeRetired}
        // Con «Estado: Dado de baja» las bajas ya están a la vista: la casilla no se puede apagar.
        disabled={filters.state === "baja"}
        onChange={(event) => {
          setIncludeRetired(event.target.checked)
          setFilter("bajas", event.target.checked ? "1" : null)
        }}
      />
    </FilterToolbar>
  )
}

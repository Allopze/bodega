"use client"

import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect, type OptionSelectOption } from "@/components/ui/option-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { formatDate } from "@/lib/utils"
import {
  RECORD_ALERT_LABEL, RECORD_ALERTS, RECORD_FILTER_PARAMS, RECORD_SITUATION_LABEL, RECORD_SITUATIONS, advancedFilterCount, parseRecordFilters,
} from "@/lib/services/mantencion/records-filters"
import type { RecordFilterOptions } from "@/lib/services/mantencion/records-query"

/** En la barra los selects toman su ancho natural (la barra les fija `w-auto`); en «Más filtros» llenan el ancho del panel. */
const BAR_SELECT_CLASS = "h-11 text-xs sm:h-8"
const PANEL_SELECT_CLASS = "h-11 w-full text-xs sm:h-8"

const KIND_OPTIONS: OptionSelectOption[] = [
  { value: "P", label: "Preventiva" },
  { value: "C", label: "Correctiva" },
]
const STATUS_OPTIONS: OptionSelectOption[] = [
  { value: "vigente", label: "Vigentes" },
  { value: "anulado", label: "Anulados" },
]
const ALERT_OPTIONS: OptionSelectOption[] = RECORD_ALERTS.map((value) => ({ value, label: RECORD_ALERT_LABEL[value] }))
const SITUATION_OPTIONS: OptionSelectOption[] = RECORD_SITUATIONS.map((value) => ({ value, label: RECORD_SITUATION_LABEL[value] }))

/**
 * Filtros de «Registros» (A2): seis primarios a la vista —equipo, faena, tipo,
 * «Hecho por», desde y hasta— y el resto en «Más filtros (N)», con una pastilla
 * removible por cada filtro activo. Todo vive en la URL (`router.replace`, sin
 * mover el scroll) y la lista se filtra en el servidor: por eso la búsqueda es
 * propia y esta ruta está en `ROUTES_WITH_OWN_SEARCH`.
 *
 * La revisión NO está aquí: son las pestañas sobre la tabla (regla A5, una
 * dimensión = una representación), así que ni es un filtro del panel ni cuenta
 * en «Más filtros (N)», y «Limpiar filtros» no cambia de pestaña.
 *
 * «Hecho por» (quién ejecutó el trabajo) y «Registrado por» (quién lo firmó en
 * el sistema) son filtros distintos a propósito: regla 10. Los rótulos del panel
 * siguen a los de la tabla: «Estado del registro» (vigente o anulado) y «Estado
 * del trabajo» (en taller, con ítems no realizados) son las dos mitades de la
 * columna «Estado».
 */
export function RecordsFilters({ options }: { options: RecordFilterOptions }) {
  const { searchParams, setFilter, setFilters, getFilter } = useUrlFilters()
  const filters = parseRecordFilters(Object.fromEntries(searchParams.entries()))
  const showWorksite = options.worksites.length > 1

  const worksiteOptions: OptionSelectOption[] = options.worksites.map((item) => ({ value: item.id, label: item.name }))
  const labelOf = (list: OptionSelectOption[], value: string | undefined) => String(list.find((item) => item.value === value)?.label ?? value ?? "")

  const chips: ActiveFilterChip[] = []
  const add = (key: string, label: string, value: string | undefined, displayValue: string) => {
    if (value) chips.push({ key, label, value, displayValue })
  }
  add("equipo", "Equipo", filters.equipment, filters.equipment ?? "")
  add("faena", "Faena", filters.worksiteId, labelOf(worksiteOptions, filters.worksiteId))
  add("tipo", "Tipo", filters.kind, labelOf(KIND_OPTIONS, filters.kind))
  add("hecho", "Hecho por", filters.executor, labelOf(options.executors, filters.executor))
  add("desde", "Desde", filters.from, filters.from ? formatDate(filters.from) : "")
  add("hasta", "Hasta", filters.to, filters.to ? formatDate(filters.to) : "")
  add("registro", "Registrado por", filters.registeredBy, labelOf(options.registrars, filters.registeredBy))
  add("estado", "Estado del registro", filters.status, labelOf(STATUS_OPTIONS, filters.status))
  add("alerta", "Alerta", filters.alert, labelOf(ALERT_OPTIONS, filters.alert))
  add("situacion", "Estado del trabajo", filters.situation, labelOf(SITUATION_OPTIONS, filters.situation))

  return (
    <FilterToolbar
      overflowTitle="Más filtros de registros"
      overflowDescription="Acota por quién registró, el estado del registro y del trabajo, o una alerta."
      activeChips={chips}
      activeCount={advancedFilterCount(filters)}
      onRemoveChip={(key) => setFilter(key, null)}
      onClearAll={() => setFilters(Object.fromEntries(RECORD_FILTER_PARAMS.map((key) => [key, null])))}
      overflowFilters={(
        <>
          <Field label="Registrado por" htmlFor="rec-f-registro">
            <OptionSelect id="rec-f-registro" className={PANEL_SELECT_CLASS} emptyLabel="Todas las personas" options={options.registrars} value={getFilter("registro")} onValueChange={(v) => setFilter("registro", v)} />
          </Field>
          <Field label="Estado del registro" htmlFor="rec-f-estado">
            <OptionSelect id="rec-f-estado" className={PANEL_SELECT_CLASS} emptyLabel="Vigentes y anulados" options={STATUS_OPTIONS} value={getFilter("estado")} onValueChange={(v) => setFilter("estado", v)} />
          </Field>
          <Field label="Alerta" htmlFor="rec-f-alerta">
            <OptionSelect id="rec-f-alerta" className={PANEL_SELECT_CLASS} emptyLabel="Con o sin alertas" options={ALERT_OPTIONS} value={getFilter("alerta")} onValueChange={(v) => setFilter("alerta", v)} />
          </Field>
          <Field label="Estado del trabajo" htmlFor="rec-f-situacion">
            <OptionSelect id="rec-f-situacion" className={PANEL_SELECT_CLASS} emptyLabel="Cualquiera" options={SITUATION_OPTIONS} value={getFilter("situacion")} onValueChange={(v) => setFilter("situacion", v)} />
          </Field>
        </>
      )}
    >
      <FilterSearchInput param="equipo" placeholder="Código o patente" ariaLabel="Buscar equipo por código o patente" className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-36" />
      {showWorksite && (
        <OptionSelect aria-label="Filtrar por faena" className={BAR_SELECT_CLASS} emptyLabel="Todas las faenas" options={worksiteOptions} value={getFilter("faena")} onValueChange={(v) => setFilter("faena", v)} />
      )}
      <OptionSelect aria-label="Filtrar por tipo de mantención" className={BAR_SELECT_CLASS} emptyLabel="Todos los tipos" options={KIND_OPTIONS} value={getFilter("tipo")} onValueChange={(v) => setFilter("tipo", v)} />
      <OptionSelect aria-label="Filtrar por quién hizo el trabajo" className={BAR_SELECT_CLASS} emptyLabel="Hecho por: todos" options={options.executors} value={getFilter("hecho")} onValueChange={(v) => setFilter("hecho", v)} />
      {/* Bajo `sm` las dos fechas comparten fila: apiladas costaban dos filas de 44 px. */}
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
        <div className="min-w-0 sm:w-32">
          <DatePicker ariaLabel="Desde" placeholder="Desde" value={getFilter("desde")} max={filters.to} onChange={(iso) => setFilter("desde", iso)} />
        </div>
        <div className="min-w-0 sm:w-32">
          <DatePicker ariaLabel="Hasta" placeholder="Hasta" value={getFilter("hasta")} min={filters.from} onChange={(iso) => setFilter("hasta", iso)} />
        </div>
      </div>
    </FilterToolbar>
  )
}

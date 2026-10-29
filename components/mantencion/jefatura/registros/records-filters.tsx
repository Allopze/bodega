"use client"

import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect, type OptionSelectOption } from "@/components/ui/option-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { REVIEW_LABEL } from "@/lib/mantencion/format"
import { formatDate } from "@/lib/utils"
import {
  RECORD_ALERT_LABEL, RECORD_ALERTS, RECORD_SITUATION_LABEL, RECORD_SITUATIONS, advancedFilterCount, parseRecordFilters,
} from "@/lib/services/mantencion/records-filters"
import type { RecordFilterOptions } from "@/lib/services/mantencion/records-query"

const SELECT_CLASS = "h-11 w-full text-xs sm:h-8 sm:w-44"

const KIND_OPTIONS: OptionSelectOption[] = [
  { value: "P", label: "Preventiva" },
  { value: "C", label: "Correctiva" },
]
const STATUS_OPTIONS: OptionSelectOption[] = [
  { value: "vigente", label: "Vigentes" },
  { value: "anulado", label: "Anulados" },
]
const REVIEW_OPTIONS: OptionSelectOption[] = (["pendiente", "observado", "revisado"] as const).map((value) => ({ value, label: REVIEW_LABEL[value] }))
const ALERT_OPTIONS: OptionSelectOption[] = RECORD_ALERTS.map((value) => ({ value, label: RECORD_ALERT_LABEL[value] }))
const SITUATION_OPTIONS: OptionSelectOption[] = RECORD_SITUATIONS.map((value) => ({ value, label: RECORD_SITUATION_LABEL[value] }))

/** Todo lo que la barra escribe en la URL: «Limpiar filtros» los quita todos y deja el orden. */
const FILTER_KEYS = ["faena", "tipo", "equipo", "hecho", "registro", "desde", "hasta", "estado", "revision", "alerta", "situacion"] as const

/**
 * Filtros de «Registros» (A2): seis primarios a la vista —equipo, faena, tipo,
 * «Hecho por», desde y hasta— y el resto en «Más filtros (N)», con una pastilla
 * removible por cada filtro activo. Todo vive en la URL (`router.replace`, sin
 * mover el scroll) y la lista se filtra en el servidor: por eso la búsqueda es
 * propia y esta ruta está en `ROUTES_WITH_OWN_SEARCH`.
 *
 * «Hecho por» (quién ejecutó el trabajo) y «Registrado por» (quién lo firmó en
 * el sistema) son filtros distintos a propósito: regla 10.
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
  add("estado", "Estado", filters.status, labelOf(STATUS_OPTIONS, filters.status))
  add("revision", "Revisión", filters.review, labelOf(REVIEW_OPTIONS, filters.review))
  add("alerta", "Alerta", filters.alert, labelOf(ALERT_OPTIONS, filters.alert))
  add("situacion", "Situación", filters.situation, labelOf(SITUATION_OPTIONS, filters.situation))

  return (
    <FilterToolbar
      activeChips={chips}
      activeCount={advancedFilterCount(filters)}
      onRemoveChip={(key) => setFilter(key, null)}
      onClearAll={() => setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))}
      overflowFilters={(
        <>
          <Field label="Registrado por" htmlFor="rec-f-registro">
            <OptionSelect id="rec-f-registro" className={SELECT_CLASS} emptyLabel="Todas las personas" options={options.registrars} value={getFilter("registro")} onValueChange={(v) => setFilter("registro", v)} />
          </Field>
          <Field label="Estado del registro" htmlFor="rec-f-estado">
            <OptionSelect id="rec-f-estado" className={SELECT_CLASS} emptyLabel="Vigentes y anulados" options={STATUS_OPTIONS} value={getFilter("estado")} onValueChange={(v) => setFilter("estado", v)} />
          </Field>
          <Field label="Revisión" htmlFor="rec-f-revision">
            <OptionSelect id="rec-f-revision" className={SELECT_CLASS} emptyLabel="Cualquier revisión" options={REVIEW_OPTIONS} value={getFilter("revision")} onValueChange={(v) => setFilter("revision", v)} />
          </Field>
          <Field label="Alerta" htmlFor="rec-f-alerta">
            <OptionSelect id="rec-f-alerta" className={SELECT_CLASS} emptyLabel="Con o sin alertas" options={ALERT_OPTIONS} value={getFilter("alerta")} onValueChange={(v) => setFilter("alerta", v)} />
          </Field>
          <Field label="Situación" htmlFor="rec-f-situacion">
            <OptionSelect id="rec-f-situacion" className={SELECT_CLASS} emptyLabel="Cualquier situación" options={SITUATION_OPTIONS} value={getFilter("situacion")} onValueChange={(v) => setFilter("situacion", v)} />
          </Field>
        </>
      )}
    >
      <FilterSearchInput param="equipo" placeholder="Código o patente del equipo" ariaLabel="Buscar equipo por código o patente" />
      {showWorksite && (
        <OptionSelect aria-label="Filtrar por faena" className={SELECT_CLASS} emptyLabel="Todas las faenas" options={worksiteOptions} value={getFilter("faena")} onValueChange={(v) => setFilter("faena", v)} />
      )}
      <OptionSelect aria-label="Filtrar por tipo de mantención" className={SELECT_CLASS} emptyLabel="Preventiva y correctiva" options={KIND_OPTIONS} value={getFilter("tipo")} onValueChange={(v) => setFilter("tipo", v)} />
      <OptionSelect aria-label="Filtrar por quién hizo el trabajo" className={SELECT_CLASS} emptyLabel="Hecho por: todos" options={options.executors} value={getFilter("hecho")} onValueChange={(v) => setFilter("hecho", v)} />
      <div className="w-full sm:w-40">
        <DatePicker ariaLabel="Desde" placeholder="Desde" value={getFilter("desde")} max={filters.to} onChange={(iso) => setFilter("desde", iso)} />
      </div>
      <div className="w-full sm:w-40">
        <DatePicker ariaLabel="Hasta" placeholder="Hasta" value={getFilter("hasta")} min={filters.from} onChange={(iso) => setFilter("hasta", iso)} />
      </div>
    </FilterToolbar>
  )
}

"use client"

import { DatePicker } from "@/components/ui/date-picker"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect, type OptionSelectOption } from "@/components/ui/option-select"
import { SPECIALTIES, SPECIALTY_LABELS } from "@/lib/mantencion/action-type"
import { HISTORY_SOURCES, HISTORY_SOURCE_LABELS, type HistoryPeriodKind } from "@/lib/mantencion/history-view"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { formatDate } from "@/lib/utils"

const SELECT_CLASS = "h-11 text-xs sm:h-8"

const PERIOD_OPTIONS: OptionSelectOption[] = [
  { value: "12m", label: "Últimos 12 meses" },
  { value: "todo", label: "Todo el historial" },
  { value: "personalizado", label: "Rango de fechas" },
]
const SOURCE_OPTIONS: OptionSelectOption[] = HISTORY_SOURCES.map((value) => ({ value, label: HISTORY_SOURCE_LABELS[value] }))
const WORKSHOP_OPTIONS: OptionSelectOption[] = [{ value: "interno", label: "Interno" }, { value: "externo", label: "Externo" }]
const SPECIALTY_OPTIONS: OptionSelectOption[] = SPECIALTIES.map((value) => ({ value, label: SPECIALTY_LABELS[value] }))

/** Lo que el servidor ya resolvió de la URL y los filtros necesitan para dibujarse (nombres, no ids). */
export interface HistoryFiltersState {
  period: HistoryPeriodKind
  from: string
  to: string
  /** Rótulos de los chips que sólo tienen id en la URL. */
  worksiteName?: string
  vehicleLabel?: string
}

/**
 * Filtros del Historial de mantenciones. El período, la faena y el equipo cambian qué se LEE de la base; el resto
 * (búsqueda, origen, taller, especialidad) filtra lo ya leído. Todos se aplican al cambiar —URL con `router.replace`,
 * sin mover el scroll y sin botón «Buscar» (A6)—. `?equipo=` llega desde la matriz, el ranking o la ficha del equipo y
 * no tiene control propio: se ve como pastilla removible. El tipo y la vista no están aquí: son los controles
 * segmentados de la página (una dimensión, una representación).
 */
export function HistoryFilters({ worksites, state }: { worksites: Array<{ id: string; name: string; isActive: boolean }>; state: HistoryFiltersState }) {
  const { searchParams, setFilter, setFilters, getFilter } = useUrlFilters()
  const q = searchParams.get("q") ?? ""
  const worksiteId = getFilter("faena")
  const vehicleId = getFilter("equipo")
  const source = getFilter("origen")
  const workshop = getFilter("taller")
  const specialty = getFilter("especialidad")

  const moreCount = [workshop, specialty].filter(Boolean).length
  const worksiteOptions: OptionSelectOption[] = worksites.map((site) => ({ value: site.id, label: site.isActive ? site.name : `${site.name} (cerrada)` }))

  const chips: ActiveFilterChip[] = []
  if (q) chips.push({ key: "q", label: "Búsqueda", value: q, displayValue: q })
  if (worksiteId) chips.push({ key: "faena", label: "Faena", value: worksiteId, displayValue: state.worksiteName ?? "La elegida" })
  if (vehicleId) chips.push({ key: "equipo", label: "Equipo", value: vehicleId, displayValue: state.vehicleLabel ?? "El elegido" })
  if (source) chips.push({ key: "origen", label: "Origen", value: source, displayValue: String(SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source) })
  if (workshop) chips.push({ key: "taller", label: "Responsable", value: workshop, displayValue: workshop === "externo" ? "Externo" : "Interno" })
  if (specialty) chips.push({ key: "especialidad", label: "Especialidad", value: specialty, displayValue: String(SPECIALTY_OPTIONS.find((option) => option.value === specialty)?.label ?? specialty) })
  if (state.period === "todo") chips.push({ key: "periodo", label: "Período", value: "todo", displayValue: "Todo el historial" })
  if (state.period === "personalizado") {
    chips.push({ key: "desde", label: "Desde", value: state.from, displayValue: formatDate(state.from) })
    chips.push({ key: "hasta", label: "Hasta", value: state.to, displayValue: formatDate(state.to) })
  }

  function changePeriod(next: string) {
    if (next === "personalizado") setFilters({ periodo: null, desde: state.from, hasta: state.to })
    else setFilters({ periodo: next === "todo" ? "todo" : null, desde: null, hasta: null })
  }

  return (
    <FilterToolbar
      activeChips={chips}
      onRemoveChip={(key) => {
        // Quitar una fecha vuelve al período por defecto: un rango a medias no es un período.
        if (key === "desde" || key === "hasta") setFilters({ desde: null, hasta: null })
        else setFilter(key, null)
      }}
      onClearAll={() => setFilters({ q: null, faena: null, equipo: null, origen: null, tipo: null, taller: null, especialidad: null, periodo: null, desde: null, hasta: null })}
    >
      <FilterSearchInput
        placeholder="Equipo, trabajo, orden o taller"
        ariaLabel="Buscar en el historial de mantenciones"
        className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-72"
      />
      <OptionSelect aria-label="Filtrar por faena" className={SELECT_CLASS} emptyLabel="Todas las faenas" options={worksiteOptions} value={worksiteId} onValueChange={(value) => setFilter("faena", value)} />
      <OptionSelect aria-label="Filtrar por origen del trabajo" className={SELECT_CLASS} emptyLabel="Todos los orígenes" options={SOURCE_OPTIONS} value={source} onValueChange={(value) => setFilter("origen", value)} />
      <OptionSelect aria-label="Período del historial" className={SELECT_CLASS} options={PERIOD_OPTIONS} value={state.period} onValueChange={changePeriod} />
      {state.period === "personalizado" && (
        <>
          <DatePicker ariaLabel="Trabajos desde" placeholder="Desde" value={state.from} max={state.to} onChange={(value) => setFilter("desde", value)} className="h-11 w-full text-xs sm:h-8 sm:w-36" />
          <DatePicker ariaLabel="Trabajos hasta" placeholder="Hasta" value={state.to} min={state.from} onChange={(value) => setFilter("hasta", value)} className="h-11 w-full text-xs sm:h-8 sm:w-36" />
        </>
      )}
      {/* A2: cuatro filtros a la vista y el resto bajo «Más filtros» (con su contador). */}
      <details open={moreCount > 0} className="group">
        <summary className="inline-flex h-11 cursor-pointer list-none items-center rounded-[var(--radius-md)] border border-[var(--color-border-strong)] px-3 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] sm:h-8 [&::-webkit-details-marker]:hidden">
          {moreCount > 0 ? `Más filtros (${moreCount})` : "Más filtros"}
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <OptionSelect aria-label="Filtrar por taller interno o externo" className={SELECT_CLASS} emptyLabel="Interno y externo" options={WORKSHOP_OPTIONS} value={workshop} onValueChange={(value) => setFilter("taller", value)} />
          <OptionSelect aria-label="Filtrar por especialidad" className={SELECT_CLASS} emptyLabel="Todas las especialidades" options={SPECIALTY_OPTIONS} value={specialty} onValueChange={(value) => setFilter("especialidad", value)} />
        </div>
      </details>
    </FilterToolbar>
  )
}

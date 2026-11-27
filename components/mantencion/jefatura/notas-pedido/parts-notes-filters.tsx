"use client"

import { DatePicker } from "@/components/ui/date-picker"
import { FilterSearchInput } from "@/components/ui/filter-search-input"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { OptionSelect } from "@/components/ui/option-select"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { formatDate } from "@/lib/utils"
import {
  advancedFilterCount, NOTE_FILTER_PARAMS, NOTE_STATUS_TEXT, parsePartsNoteFilters, STATUSES_BY_TAB, URGENCY_OPTIONS, type InboxTab,
} from "./parts-notes-format"

const BAR_SELECT_CLASS = "h-11 text-xs sm:h-8"
const SHEET_INPUT_CLASS = "h-11 w-full pl-8 text-xs sm:h-9"

/**
 * Filtros de la bandeja (A2): cinco primarios —búsqueda, faena, urgencia, creada desde y creada hasta— y, en «Más filtros»
 * con su contador, el estado exacto, el solicitante, el equipo y el repuesto. Una pastilla removible por cada filtro activo.
 * Todo vive en la URL (`router.replace`, sin mover el scroll) y lo resuelve el servidor: la ruta está en `ROUTES_WITH_OWN_SEARCH`
 * y la búsqueda va rotulada, porque la lista pagina en el servidor y el filtro de la barra superior sólo vería la página cargada.
 *
 * El estado exacto (uno de los nueve) afina DENTRO de la pestaña activa y sólo ofrece los estados de esa pestaña (A5: la
 * pestaña sigue siendo la representación principal del estado). En «Por conciliar» no hay notas que filtrar: sólo la faena.
 * Con una sola faena en el alcance no hay nada que elegir y el selector no se dibuja.
 */
export function PartsNotesFilters({ worksites, allWorksitesLabel, tab = "pendientes" }: {
  worksites: Array<{ id: string; name: string }>
  allWorksitesLabel: string
  tab?: InboxTab
}) {
  const { searchParams, setFilter, setFilters, getFilter } = useUrlFilters({ pageKey: "pagina" })
  const filters = parsePartsNoteFilters(Object.fromEntries(searchParams.entries()))
  const showWorksite = worksites.length > 1
  const onConciliation = tab === "por_conciliar"

  const worksiteId = getFilter("faena")
  const urgency = URGENCY_OPTIONS.find((option) => option.value === getFilter("urgencia"))
  const from = filters.from ?? ""
  const to = filters.to ?? ""
  const statusOptions = onConciliation ? [] : STATUSES_BY_TAB[tab].map((status) => ({ value: status, label: NOTE_STATUS_TEXT[status] }))

  const chips: ActiveFilterChip[] = []
  const add = (key: string, label: string, value: string | undefined, displayValue?: string) => {
    if (value) chips.push({ key, label, value, displayValue: displayValue ?? value })
  }
  add("faena", "Faena", worksiteId, worksites.find((item) => item.id === worksiteId)?.name)
  if (!onConciliation) {
    add("q", "Búsqueda", filters.q)
    add("urgencia", "Urgencia", urgency?.value, urgency?.label)
    add("desde", "Creada desde", from, from ? formatDate(from) : undefined)
    add("hasta", "Creada hasta", to, to ? formatDate(to) : undefined)
    add("situacion", "Estado", filters.status, filters.status ? NOTE_STATUS_TEXT[filters.status] : undefined)
    add("solicitante", "Solicitante", filters.requester)
    add("equipo", "Equipo", filters.equipment)
    add("articulo", "Repuesto", filters.article)
  }

  if (onConciliation && !showWorksite) return null

  return (
    <FilterToolbar
      activeChips={chips}
      activeCount={onConciliation ? 0 : advancedFilterCount(filters)}
      onRemoveChip={(key) => setFilter(key, null)}
      onClearAll={() => setFilters(Object.fromEntries(NOTE_FILTER_PARAMS.map((key) => [key, null])))}
      overflowTitle="Más filtros de las notas"
      overflowDescription="Afina por estado, solicitante, equipo o repuesto."
      overflowFilters={onConciliation ? undefined : (
        <>
          <OptionSelect
            aria-label="Filtrar por estado"
            className={BAR_SELECT_CLASS}
            emptyLabel="Todos los estados de la pestaña"
            options={statusOptions}
            value={filters.status ?? ""}
            onValueChange={(value) => setFilter("situacion", value)}
          />
          <FilterSearchInput param="solicitante" pageKeys={["pagina"]} placeholder="Solicitante" ariaLabel="Filtrar por solicitante" className={SHEET_INPUT_CLASS} />
          <FilterSearchInput param="equipo" pageKeys={["pagina"]} placeholder="Equipo: código, patente o cargo" ariaLabel="Filtrar por equipo" className={SHEET_INPUT_CLASS} />
          <FilterSearchInput param="articulo" pageKeys={["pagina"]} placeholder="Repuesto: texto, N° de parte o producto" ariaLabel="Filtrar por repuesto" className={SHEET_INPUT_CLASS} />
        </>
      )}
    >
      {!onConciliation && (
        <FilterSearchInput
          param="q"
          pageKeys={["pagina"]}
          placeholder="Nota, OT, equipo, solicitante o repuesto"
          ariaLabel="Buscar notas de pedido por código, orden de trabajo, equipo, solicitante o repuesto"
          className="h-11 w-full pl-8 text-xs sm:h-8 sm:w-72"
        />
      )}
      {showWorksite && (
        <OptionSelect
          aria-label="Filtrar por faena"
          className={BAR_SELECT_CLASS}
          emptyLabel={allWorksitesLabel}
          options={worksites.map((item) => ({ value: item.id, label: item.name }))}
          value={worksiteId}
          onValueChange={(value) => setFilter("faena", value)}
        />
      )}
      {!onConciliation && (
        <>
          <OptionSelect
            aria-label="Filtrar por urgencia"
            className={BAR_SELECT_CLASS}
            emptyLabel="Toda urgencia"
            options={URGENCY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            value={urgency?.value ?? ""}
            onValueChange={(value) => setFilter("urgencia", value)}
          />
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <div className="min-w-0 sm:w-36">
              <DatePicker ariaLabel="Creada desde" placeholder="Creada desde" value={from} max={to || undefined} onChange={(iso) => setFilter("desde", iso)} />
            </div>
            <div className="min-w-0 sm:w-36">
              <DatePicker ariaLabel="Creada hasta" placeholder="Creada hasta" value={to} min={from || undefined} onChange={(iso) => setFilter("hasta", iso)} />
            </div>
          </div>
        </>
      )}
    </FilterToolbar>
  )
}

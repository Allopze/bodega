"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FilterToolbar } from "@/components/ui/filter-toolbar"
import { PeriodControl } from "@/components/ui/period-control"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { DEFAULT_RANGE_LABEL, defaultIndicatorRange } from "@/lib/indicators/period"
import { frequencyLabel } from "@/lib/services/mantencion/looker/filters"
import { clearFiltersHref, removeChipHref, unitHref } from "@/lib/services/mantencion/looker/filter-hrefs"
import type {
  FilterChip, LookerFilters, LookerOptions, ResolvedCrossFilters,
} from "@/lib/services/mantencion/looker/types"
import { MultiSelectPopover, type MultiOption } from "./multi-select-popover"

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))]
}

/**
 * Planificación es el estado de hoy de cada equipo: ninguna de sus consultas filtra por fecha, así que su barra no
 * ofrece el período (PAN4-6). El período sigue en la URL para las otras pestañas.
 */
function hasPeriod(tab: LookerFilters["tab"]): boolean {
  return tab !== "planificacion"
}

/** `href` con el `desde` y el `hasta` de la URL actual: lo que «Borrar filtros» no debe quitar donde el período no se ve. */
function keepPeriod(href: string, current: URLSearchParams): string {
  const [path = href, query = ""] = href.split("?")
  const params = new URLSearchParams(query)
  for (const key of ["desde", "hasta"]) {
    const value = current.get(key)
    if (value?.trim()) params.set(key, value)
  }
  const next = params.toString()
  return next ? `${path}?${next}` : path
}

/**
 * Barra de filtros de las pestañas Looker: la unidad de control (km u horas, un enlace que suelta lo que nombra un
 * equipo de la otra unidad), el rango (salvo en Planificación, que no tiene período y trae su filtro por fechas en
 * `children`), faena múltiple, equipo con búsqueda y frecuencia. Los controles reflejan lo que fijó un clic (el equipo deriva su faena y su
 * frecuencia), pero el clic sigue viviendo en su propio parámetro `x_*`: cambiarlo a mano
 * limpia el filtro cruzado de esa dimensión para que no se contradigan.
 */
export function LookerFilterBar({
  filters,
  options,
  cross,
  chips,
  children,
}: {
  filters: LookerFilters
  options: LookerOptions
  cross: ResolvedCrossFilters
  chips: FilterChip[]
  /** Controles propios de la pestaña (el filtro por fechas de Planificación), después del período. */
  children?: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => setReady(true), [])

  const worksiteValues = unique([
    ...filters.worksiteIds,
    cross.worksite?.id,
    cross.equipment?.worksiteId,
    cross.work?.worksiteId,
    cross.check?.worksiteId,
  ])
  const equipmentValues = unique([...filters.equipmentIds, cross.equipment?.id])
  const frequencyValues = unique([
    ...filters.frequencies.map(String),
    cross.equipment?.frequency ? String(cross.equipment.frequency) : undefined,
  ])

  const worksiteOptions: MultiOption[] = options.worksites.map((site) => ({ value: site.id, label: site.name }))
  const equipmentOptions: MultiOption[] = options.equipment.map((equipment) => ({
    value: equipment.id,
    label: equipment.label,
    hint: equipment.worksiteName,
  }))
  const frequencyOptions: MultiOption[] = options.frequencies.map((frequency) => ({
    value: String(frequency.value),
    label: frequencyLabel(frequency.value, frequency.unit),
    hint: frequency.unit,
  }))

  function navigate(href: string) {
    startTransition(() => router.replace(href, { scroll: false }))
  }

  function setMulti(param: "faena" | "equipo" | "frecuencia", values: string[]) {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (values.length > 0) params.set(param, values.join(","))
    else params.delete(param)
    if (param === "faena") for (const key of ["x_faena", "x_equipo", "x_ot", "x_check"]) params.delete(key)
    if (param === "equipo") for (const key of ["x_equipo", "x_ot", "x_check", "ficha", "pauta"]) params.delete(key)
    if (param === "frecuencia") params.delete("x_equipo")
    params.delete("page")
    const query = params.toString()
    navigate(query ? `${pathname}?${query}` : pathname)
  }

  const showPeriod = hasPeriod(filters.tab)
  const clear = () => {
    const href = clearFiltersHref(pathname, filters.tab, filters.unit)
    // Sin el control a la vista, borrar filtros no puede llevarse el período que se eligió en otra pestaña.
    navigate(showPeriod ? href : keepPeriod(href, new URLSearchParams(Array.from(searchParams.entries()))))
  }

  return (
    <div data-looker-filter-bar="" data-looker-filter-ready={ready ? "" : undefined} aria-busy={pending || undefined}>
      <FilterToolbar
        activeChips={chips}
        onRemoveChip={(key) => {
          const chip = chips.find((item) => item.key === key)
          if (!chip) return
          navigate(removeChipHref(pathname, new URLSearchParams(Array.from(searchParams.entries())), chip))
        }}
        onClearAll={clear}
        hasActiveFilters={chips.length > 0}
        clearLabel="Borrar filtros"
      >
        <SegmentedControl
          variant="segmented"
          eyebrow="Unidad de control"
          ariaLabel="Unidad de control"
          items={([["km", "Por kilómetros"], ["h", "Por horas"]] as const).map(([unit, label]) => ({
            key: unit,
            label,
            active: filters.unit === unit,
            href: unitHref(pathname, new URLSearchParams(Array.from(searchParams.entries())), unit),
          }))}
        />
        {showPeriod && (
          <PeriodControl
            mode="range"
            from={filters.requestedFrom}
            to={filters.requestedTo}
            defaultRange={{ ...defaultIndicatorRange(), label: DEFAULT_RANGE_LABEL }}
          />
        )}
        {children}
        <MultiSelectPopover
          label="Faena"
          options={worksiteOptions}
          values={worksiteValues}
          onChange={(values) => setMulti("faena", values)}
          emptyLabel="Todas"
        />
        <MultiSelectPopover
          label="Equipo"
          options={equipmentOptions}
          values={equipmentValues}
          onChange={(values) => setMulti("equipo", values)}
          emptyLabel="Todos"
          searchPlaceholder="Buscar código o patente..."
        />
        <MultiSelectPopover
          label="Frecuencia"
          options={frequencyOptions}
          values={frequencyValues}
          onChange={(values) => setMulti("frecuencia", values)}
          emptyLabel="Todas"
        />
      </FilterToolbar>
    </div>
  )
}

import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { toControlPeriod } from "@/lib/combustibles/period/adapters"
import { controlFiltersToParams, parseControlFilters, type ControlFilters } from "../filters"
import type { PerformanceFamily } from "../contracts"

type SearchParams = Record<string, string | string[] | undefined>

/**
 * Filtros del control (`ControlFilters`) con el período de la cabecera. El
 * período ya no viaja como `anio`/`meses`/`desde`/`hasta` propios de la vista:
 * lo resuelve `resolveFuelPeriodForPage` y este adaptador lo traduce a lo que
 * entienden las consultas existentes (`toControlPeriod`). Lo demás (faena,
 * mandante, unidad, medio, equipo y página) sale de la URL.
 */
export function controlFiltersFromPeriod(
  period: ResolvedFuelPeriod,
  searchParams: SearchParams = {},
  defaults: { family?: PerformanceFamily } = {},
): ControlFilters {
  const parsed = parseControlFilters(searchParams, defaults)
  const { year, months, from, to } = toControlPeriod(period)
  return { ...parsed, year, months, from: from ?? undefined, to: to ?? undefined }
}

/** Filtros de una pantalla como parámetros de texto, para las acciones de exportación (que los vuelven a leer con `parseControlFilters`). */
export function exportParamsFromFilters(filters: ControlFilters): Record<string, string> {
  return Object.fromEntries(controlFiltersToParams({ ...filters, page: 1 }))
}

import { FUEL_PATHS } from "@/lib/combustibles/routes"

export type ConsumptionQueryChanges = Record<string, string | null | undefined>

/**
 * Mantiene el contexto de análisis al navegar dentro de los análisis de
 * consumo por tarjeta. Los cambios de filtros vuelven siempre a la primera
 * página; la paginación no.
 *
 * Antes cada enlace apuntaba a `/combustibles`, que hoy es el Panel. `pathname`
 * dice a qué pantalla va: sin él es «Cargas › Tarjetas», la tabla de totales por
 * patente y mes (el único consumidor que no lo pasa); el análisis de tarjetas de
 * «Consumo» usa `buildLitrosHref`.
 */
export function buildConsumptionHref(
  currentSearch: string,
  changes: ConsumptionQueryChanges,
  { resetPage = true, pathname = FUEL_PATHS.tarjetas }: { resetPage?: boolean; pathname?: string } = {},
) {
  const params = new URLSearchParams(currentSearch)

  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === "") params.delete(key)
    else params.set(key, value)
  }

  if (resetPage) params.delete("page")

  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

/**
 * Enlace dentro de «Consumo › Consumo» (`/consumo/litros`) con los cambios
 * pedidos. Un filtro del análisis de tarjetas abre ese análisis (`seccion=tarjetas`):
 * el filtro sólo existe ahí, y dejarlo con la sección cerrada se vería como un
 * filtro invisible.
 */
export function buildLitrosHref(currentSearch: string, changes: ConsumptionQueryChanges, options: { section?: string } = {}) {
  const section = options.section ?? "tarjetas"
  return buildConsumptionHref(currentSearch, { seccion: section, ...changes }, { pathname: FUEL_PATHS.consumoLitros })
}

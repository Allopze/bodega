import { FUEL_PATHS } from "@/lib/combustibles/routes"
import type { FuelLoadStateSlug } from "@/lib/combustibles/fuel-log-shared"

/**
 * Enlaces del Panel a «Cargas» con lo que le toca a una persona. `mias=si`
 * acota la lista a las cargas que registró ella; `estado` es el slug de
 * `FUEL_LOAD_STATE_SLUGS` (el mismo que entiende el filtro de la lista).
 * `link` agrega el período (`panelLinker`).
 */
export function myLoadsHref(link: (href: string) => string, state?: FuelLoadStateSlug): string {
  const params = new URLSearchParams({ mias: "si" })
  if (state) params.set("estado", state)
  return link(`${FUEL_PATHS.cargas}?${params.toString()}`)
}

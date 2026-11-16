/**
 * Ficha única del vehículo (crítica UI/UX de Control operacional, 2026-11-15, paso 4a).
 *
 * Antes cada área tenía la suya: `/flota/[id]`, `/mantencion/equipos/[id]` y
 * `/combustibles/consumo/equipos/[id]`, las tres con los datos del equipo repetidos y
 * enlazadas entre sí con botones. Ahora hay una sola dirección por vehículo, `/flota/[id]`,
 * con una pestaña por área. Las pestañas son rutas y no un estado del cliente: cada área
 * carga sus propios datos (pesados y distintos) y Combustible lleva el período en la URL.
 *
 * Cada enlace abre la pestaña del área desde donde se llega: las listas de Mantención abren
 * «Mantención», las de Combustible «Combustible» (con el período), y Vehículos, el Panel
 * operacional, Monitoreo e Indicadores GPS el «Resumen». Las direcciones viejas redirigen
 * aquí conservando su query.
 *
 * Módulo puro: lo usan componentes de cliente y de servidor.
 */
export const VEHICLE_FICHA_TABS = ["resumen", "flota", "mantencion", "combustible"] as const
export type VehicleFichaTab = (typeof VEHICLE_FICHA_TABS)[number]
/** Las pestañas de un área; «Resumen» no es un área, junta una línea de cada una. */
export type VehicleFichaArea = Exclude<VehicleFichaTab, "resumen">
export const VEHICLE_FICHA_AREAS = ["flota", "mantencion", "combustible"] as const satisfies readonly VehicleFichaArea[]

export const VEHICLE_FICHA_TAB_LABELS: Record<VehicleFichaTab, string> = {
  resumen: "Resumen",
  flota: "Flota",
  mantencion: "Mantención",
  combustible: "Combustible",
}

export function isVehicleFichaTab(value: string): value is VehicleFichaTab {
  return (VEHICLE_FICHA_TABS as readonly string[]).includes(value)
}

/** Dirección de la ficha de un vehículo (`fuel_vehicles.id`), en la pestaña pedida. */
export function vehicleFichaHref(vehicleId: string, tab: VehicleFichaTab = "resumen"): string {
  const base = `/flota/${encodeURIComponent(vehicleId)}`
  return tab === "resumen" ? base : `${base}/${tab}`
}

type SearchParams = Record<string, string | string[] | undefined>

/** La misma query (repetidos incluidos) pegada a otra ruta: para redirigir sin perder `?creado=1`, `?vida=` o el período. */
export function withSearchParams(path: string, searchParams: SearchParams): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item)
  }
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

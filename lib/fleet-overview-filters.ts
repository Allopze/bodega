import type { FUEL_VEHICLE_STATUSES } from "@/lib/combustibles/validation"

/**
 * Valor de `estado` (URL) y de `operationalStatus` (filtro) que agrupa los
 * vehículos que hoy no están produciendo: en mantención o fuera de servicio.
 * El Panel operacional enlaza aquí (`/flota?estado=detenidos`) para que la
 * cifra «detenidos» y la lista que abre digan lo mismo.
 */
export const FLEET_STOPPED_FILTER = "detenidos"
export const FLEET_STOPPED_FILTER_LABEL = "Detenidos (en mantención o fuera de servicio)"
export const FLEET_STOPPED_STATUSES = ["mantencion", "fuera_servicio"] as const satisfies readonly (typeof FUEL_VEHICLE_STATUSES)[number][]

export interface FleetOverviewFilters {
  /** Un estado operativo concreto, o `FLEET_STOPPED_FILTER`. Un valor desconocido no coincide con nada. */
  operationalStatus?: string
  responsibleName?: string
  expiry?: "vencidos" | "proximos" | "al-dia"
  q?: string
}

export function filterFleetOverviewRows<T extends {
  plate: string
  brand: string | null
  model: string | null
  type: string
  worksiteName: string
  operationalStatus: string
  responsibleName: string | null
  nextExpiryDate: string | null
}>(
  rows: T[],
  filters: FleetOverviewFilters,
  dates: { today: string; warningWindowEnd: string },
): T[] {
  const query = filters.q?.trim().toLocaleLowerCase("es-CL")
  // El alias se expande a sus estados; cualquier otro valor se compara literal
  // contra el estado del vehículo (uno desconocido deja la lista vacía, nunca
  // rompe la consulta: el filtro corre en memoria, sin SQL).
  const acceptedStatuses: readonly string[] | null = !filters.operationalStatus
    ? null
    : filters.operationalStatus === FLEET_STOPPED_FILTER
      ? FLEET_STOPPED_STATUSES
      : [filters.operationalStatus]
  return rows.filter((row) => {
    if (acceptedStatuses && !acceptedStatuses.includes(row.operationalStatus)) return false
    if (filters.responsibleName && row.responsibleName !== filters.responsibleName) return false
    if (filters.expiry === "vencidos" && !(row.nextExpiryDate && row.nextExpiryDate < dates.today)) return false
    if (filters.expiry === "proximos" && !(row.nextExpiryDate && row.nextExpiryDate >= dates.today && row.nextExpiryDate <= dates.warningWindowEnd)) return false
    if (filters.expiry === "al-dia" && row.nextExpiryDate && row.nextExpiryDate <= dates.warningWindowEnd) return false
    if (query) {
      const haystack = [row.plate, row.brand, row.model, row.type, row.worksiteName, row.responsibleName]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("es-CL")
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

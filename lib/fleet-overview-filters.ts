export interface FleetOverviewFilters {
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
  return rows.filter((row) => {
    if (filters.operationalStatus && row.operationalStatus !== filters.operationalStatus) return false
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

export interface FuelControlWorksiteChannel {
  worksiteId: string
  worksiteName: string
  liters: number
}
export interface FuelControlWorksiteRow {
  worksiteId: string
  worksiteName: string
  billedLiters: number
  taeLiters: number
  tctLiters: number
}

export function mergeFuelControlWorksites(input: {
  billed: FuelControlWorksiteChannel[]
  tae: FuelControlWorksiteChannel[]
  tct: FuelControlWorksiteChannel[]
}): FuelControlWorksiteRow[] {
  const rows = new Map<string, FuelControlWorksiteRow>()

  function add(channel: "billedLiters" | "taeLiters" | "tctLiters", values: FuelControlWorksiteChannel[]) {
    for (const value of values) {
      const current = rows.get(value.worksiteId) ?? {
        worksiteId: value.worksiteId,
        worksiteName: value.worksiteName,
        billedLiters: 0,
        taeLiters: 0,
        tctLiters: 0,
      }
      current[channel] += Number(value.liters)
      rows.set(value.worksiteId, current)
    }
  }

  add("billedLiters", input.billed)
  add("taeLiters", input.tae)
  add("tctLiters", input.tct)

  return [...rows.values()].sort((a, b) => {
    const totalA = a.billedLiters + a.taeLiters + a.tctLiters
    const totalB = b.billedLiters + b.taeLiters + b.tctLiters
    return totalB - totalA || a.worksiteName.localeCompare(b.worksiteName, "es-CL")
  })
}

export function percentVariation(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 1_000) / 10
}

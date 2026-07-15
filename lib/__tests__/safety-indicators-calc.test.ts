import { describe, expect, it } from "vitest"
import { EMPTY_COUNTERS, buildMonthlyCounters, calcRates, sumCounters } from "@/lib/prevention/safety-indicators-calc"

describe("calcRates", () => {
  it("returns zero rates when horasHombre is 0 (avoids division by zero)", () => {
    const rates = calcRates({ horasHombre: 0, accConTiempoPerdido: 3, accSinTiempoPerdido: 1, diasPerdidos: 10 })
    expect(rates).toEqual({ tasaFrecuencia: 0, tasaGravedad: 0, totalAccidentes: 4 })
  })

  it("computes tasaFrecuencia and tasaGravedad per the standard formulas", () => {
    const rates = calcRates({ horasHombre: 10_000, accConTiempoPerdido: 2, accSinTiempoPerdido: 1, diasPerdidos: 20 })
    expect(rates.tasaFrecuencia).toBeCloseTo((2 / 10_000) * 1_000_000, 5)
    expect(rates.tasaGravedad).toBeCloseTo((20 / 10_000) * 1_000, 5)
    expect(rates.totalAccidentes).toBe(3)
  })
})

describe("sumCounters", () => {
  it("sums all fields across rows", () => {
    const total = sumCounters([
      { ...EMPTY_COUNTERS, trabajadores: 5, horasHombre: 100 },
      { ...EMPTY_COUNTERS, trabajadores: 3, horasHombre: 50, incidentes: 2 },
    ])
    expect(total).toEqual({ ...EMPTY_COUNTERS, trabajadores: 8, horasHombre: 150, incidentes: 2 })
  })

  it("returns all zeros for an empty row set", () => {
    expect(sumCounters([])).toEqual(EMPTY_COUNTERS)
  })
})

describe("buildMonthlyCounters", () => {
  it("fills missing months with zeroed counters", () => {
    const rows = [{ ...EMPTY_COUNTERS, worksiteId: "ws-1", month: 3, trabajadores: 10 }]
    const months = buildMonthlyCounters(rows, "ws-1")
    expect(months).toHaveLength(12)
    expect(months[2]!.trabajadores).toBe(10)
    expect(months[0]).toEqual(EMPTY_COUNTERS)
  })

  it("sums across worksites for the 'total' view", () => {
    const rows = [
      { ...EMPTY_COUNTERS, worksiteId: "ws-1", month: 1, trabajadores: 5 },
      { ...EMPTY_COUNTERS, worksiteId: "ws-2", month: 1, trabajadores: 7 },
    ]
    const months = buildMonthlyCounters(rows, "total")
    expect(months[0]!.trabajadores).toBe(12)
  })

  it("filters other worksites out of a single-faena view", () => {
    const rows = [
      { ...EMPTY_COUNTERS, worksiteId: "ws-1", month: 1, trabajadores: 5 },
      { ...EMPTY_COUNTERS, worksiteId: "ws-2", month: 1, trabajadores: 7 },
    ]
    const months = buildMonthlyCounters(rows, "ws-1")
    expect(months[0]!.trabajadores).toBe(5)
  })
})

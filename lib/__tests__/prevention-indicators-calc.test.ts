import { describe, expect, it } from "vitest"
import {
  calcRates,
  sumCounters,
  buildMonthlyCounters,
  EMPTY_COUNTERS,
  type IndicatorCounters,
  calculateCanonicalIndicatorPeriod,
  type CanonicalIndicatorCase,
  type CanonicalIndicatorEvent,
  type ControlledIndicatorDenominator,
} from "@/lib/prevention/safety-indicators-calc"

describe("SST Safety Indicators Calculator (safety-indicators-calc)", () => {
  it("returns null for frequency and severity rates when man-hours (horasHombre) is zero", () => {
    const data: IndicatorCounters = {
      ...EMPTY_COUNTERS,
      horasHombre: 0,
      accConTiempoPerdido: 2,
      diasPerdidos: 10,
    }

    const rates = calcRates(data)
    expect(rates.tasaFrecuencia).toBeNull()
    expect(rates.tasaGravedad).toBeNull()
    expect(rates.totalAccidentes).toBe(2)
  })

  it("calculates frequency rate (IF) and severity rate (IS) per 1,000,000 man-hours (DS 44 standard)", () => {
    const data: IndicatorCounters = {
      ...EMPTY_COUNTERS,
      horasHombre: 100_000,
      accConTiempoPerdido: 2,
      accSinTiempoPerdido: 3,
      diasPerdidos: 15,
    }

    const rates = calcRates(data)
    // IF = (2 / 100,000) * 1,000,000 = 20
    expect(rates.tasaFrecuencia).toBe(20)
    // IS = (15 / 100,000) * 1,000,000 = 150
    expect(rates.tasaGravedad).toBe(150)
    expect(rates.totalAccidentes).toBe(5)
  })

  it("correctly sums multiple monthly counter rows", () => {
    const row1: IndicatorCounters = {
      trabajadores: 50,
      horasHombre: 8000,
      accConTiempoPerdido: 1,
      accSinTiempoPerdido: 2,
      diasPerdidos: 5,
      incidentes: 3,
      danoMaterial: 1,
      danoAmbiental: 0,
    }
    const row2: IndicatorCounters = {
      trabajadores: 60,
      horasHombre: 9600,
      accConTiempoPerdido: 0,
      accSinTiempoPerdido: 1,
      diasPerdidos: 0,
      incidentes: 2,
      danoMaterial: 0,
      danoAmbiental: 1,
    }

    const total = sumCounters([row1, row2])

    expect(total).toEqual({
      trabajadores: 110,
      horasHombre: 17600,
      accConTiempoPerdido: 1,
      accSinTiempoPerdido: 3,
      diasPerdidos: 5,
      incidentes: 5,
      danoMaterial: 1,
      danoAmbiental: 1,
    })
  })

  it("builds 12 monthly counter slots accurately for a specific worksite", () => {
    const inputRows = [
      { ...EMPTY_COUNTERS, worksiteId: "ws-1", month: 3, horasHombre: 5000, accConTiempoPerdido: 1 },
      { ...EMPTY_COUNTERS, worksiteId: "ws-2", month: 3, horasHombre: 8000 },
      { ...EMPTY_COUNTERS, worksiteId: "ws-1", month: 7, horasHombre: 6000 },
    ]

    const monthlyWs1 = buildMonthlyCounters(inputRows, "ws-1")

    expect(monthlyWs1).toHaveLength(12)
    expect(monthlyWs1[0]).toEqual(EMPTY_COUNTERS) // Enero (index 0)
    expect(monthlyWs1[2]?.horasHombre).toBe(5000) // Marzo (index 2)
    expect(monthlyWs1[6]?.horasHombre).toBe(6000) // Julio (index 6)

    const monthlyTotal = buildMonthlyCounters(inputRows, "total")
    expect(monthlyTotal[2]?.horasHombre).toBe(13000) // Marzo sum (5000 + 8000)
  })

  it("calculates canonical indicator period status non_calculable if approved denominator is missing", () => {
    const events: CanonicalIndicatorEvent[] = []
    const cases: CanonicalIndicatorCase[] = []
    const denominators: ControlledIndicatorDenominator[] = []

    const result = calculateCanonicalIndicatorPeriod({
      year: 2026,
      startMonth: 5,
      endMonth: 5,
      events,
      cases,
      denominators,
    })

    expect(result.status).toBe("non_calculable")
    expect(result.reconciliationIssues.some((e) => e.includes("denominadores"))).toBe(true)
  })
})

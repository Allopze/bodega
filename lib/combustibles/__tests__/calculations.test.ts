import { describe, it, expect } from "vitest"
import { calculateFuelAmounts, calculateStatementTotals } from "../calculations"

describe("calculateFuelAmounts", () => {
  it("calculates with both IEC rates configured", () => {
    const result = calculateFuelAmounts({
      liters: 1000,
      baseAmount: 1_000_000,
      iecFixedRate: 104.67,
      iecVariableRate: 82.07,
    })
    expect(result.iecFixed).toBe(104_670)
    expect(result.iecVariable).toBe(82_070)
    expect(result.iecTotal).toBe(186_740)
    expect(result.ivaAmount).toBe(190_000)
    expect(result.totalAmount).toBe(1_376_740)
  })

  it("returns 0 for IEC when rates are null", () => {
    const result = calculateFuelAmounts({
      liters: 500,
      baseAmount: 500_000,
      iecFixedRate: null,
      iecVariableRate: null,
    })
    expect(result.iecFixed).toBe(0)
    expect(result.iecVariable).toBe(0)
    expect(result.iecTotal).toBe(0)
    expect(result.ivaAmount).toBe(95_000)
    expect(result.totalAmount).toBe(595_000)
  })

  it("handles zero liters", () => {
    const result = calculateFuelAmounts({
      liters: 0,
      baseAmount: 0,
      iecFixedRate: 104.67,
      iecVariableRate: 82.07,
    })
    expect(result.iecFixed).toBe(0)
    expect(result.iecVariable).toBe(0)
    expect(result.totalAmount).toBe(0)
  })

  it("handles custom IVA rate", () => {
    const result = calculateFuelAmounts({
      liters: 100,
      baseAmount: 100_000,
      iecFixedRate: null,
      iecVariableRate: null,
      ivaRate: 0.10,
    })
    expect(result.ivaAmount).toBe(10_000)
    expect(result.totalAmount).toBe(110_000)
  })

  it("rounds to 2 decimal places", () => {
    const result = calculateFuelAmounts({
      liters: 333.333,
      baseAmount: 333_333.33,
      iecFixedRate: 100.555,
      iecVariableRate: null,
    })
    expect(result.iecFixed).toBeCloseTo(33_518.3, 1)
  })
})

describe("calculateStatementTotals", () => {
  it("sums multiple loads correctly", () => {
    const loads = [
      { liters: 1000, baseAmount: 1_000_000, iecTotal: 186_740, ivaAmount: 190_000, totalAmount: 1_376_740 },
      { liters: 500, baseAmount: 500_000, iecTotal: 93_370, ivaAmount: 95_000, totalAmount: 688_370 },
    ]
    const result = calculateStatementTotals(loads)
    expect(result.totalLiters).toBe(1500)
    expect(result.totalBaseAmount).toBe(1_500_000)
    expect(result.totalIec).toBe(280_110)
    expect(result.totalIva).toBe(285_000)
    expect(result.totalAmount).toBe(2_065_110)
  })

  it("returns zeros for empty array", () => {
    const result = calculateStatementTotals([])
    expect(result.totalLiters).toBe(0)
    expect(result.totalAmount).toBe(0)
  })
})

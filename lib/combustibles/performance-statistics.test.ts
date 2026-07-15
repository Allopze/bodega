import { describe, it, expect } from "vitest"
import {
  mean, median, standardDeviation, percentile, coefficientOfVariation,
  sampleReliability, MIN_CONCLUSIVE_SAMPLE, flagOutliers,
} from "./performance-statistics"

describe("mean/median/standardDeviation", () => {
  it("computes mean, median and population standard deviation", () => {
    expect(mean([2, 4, 6])).toBe(4)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([1, 2, 3])).toBe(2)
    // Población (÷n), no muestral (÷n-1): [2,4,6] → varianza 8/3, desv ≈ 1.633.
    expect(standardDeviation([2, 4, 6])).toBeCloseTo(1.633, 2)
  })

  it("returns 0 for empty input instead of NaN", () => {
    expect(mean([])).toBe(0)
    expect(median([])).toBe(0)
    expect(standardDeviation([])).toBe(0)
  })
})

describe("percentile", () => {
  it("interpolates linearly between ranks", () => {
    const values = [10, 20, 30, 40, 50]
    expect(percentile(values, 0)).toBe(10)
    expect(percentile(values, 100)).toBe(50)
    expect(percentile(values, 50)).toBe(30)
  })
})

describe("coefficientOfVariation", () => {
  it("returns null when the mean is zero (division by zero guard)", () => {
    expect(coefficientOfVariation([-1, 0, 1])).toBeNull()
  })

  it("returns a percentage otherwise", () => {
    expect(coefficientOfVariation([10, 10, 10])).toBe(0)
  })
})

describe("sampleReliability", () => {
  it("is insuficiente below MIN_CONCLUSIVE_SAMPLE", () => {
    expect(sampleReliability(MIN_CONCLUSIVE_SAMPLE - 1)).toBe("insuficiente")
  })

  it("is baja between the threshold and double", () => {
    expect(sampleReliability(MIN_CONCLUSIVE_SAMPLE)).toBe("baja")
    expect(sampleReliability(MIN_CONCLUSIVE_SAMPLE * 2 - 1)).toBe("baja")
  })

  it("is confiable at double the threshold or above", () => {
    expect(sampleReliability(MIN_CONCLUSIVE_SAMPLE * 2)).toBe("confiable")
  })
})

describe("flagOutliers", () => {
  it("flags values beyond the threshold of standard deviations", () => {
    const rows = [{ v: 10 }, { v: 11 }, { v: 9 }, { v: 10 }, { v: 100 }]
    const flagged = flagOutliers(rows, (r) => r.v, 1.5)
    expect(flagged.find((r) => r.v === 100)?.atipico).toBe(true)
    expect(flagged.find((r) => r.v === 10)?.atipico).toBe(false)
  })

  it("does not flag anything with fewer than 3 values", () => {
    const rows = [{ v: 10 }, { v: 1000 }]
    const flagged = flagOutliers(rows, (r) => r.v)
    expect(flagged.every((r) => !r.atipico)).toBe(true)
  })
})

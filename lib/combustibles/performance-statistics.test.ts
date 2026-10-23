import { describe, it, expect } from "vitest"
import { DEFAULT_OUTLIER_THRESHOLD_STDDEVS, MIN_CONCLUSIVE_SAMPLE, flagOutliers } from "./performance-statistics"

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

  it("always flags zeros, even when there is not enough data to infer", () => {
    const flagged = flagOutliers([{ v: 0 }, { v: 12 }], (r) => r.v)
    expect(flagged.map((r) => r.atipico)).toEqual([true, false])
  })

  it("uses the population standard deviation (÷n), not the sample one (÷n−1)", () => {
    // [10, 10, 10, 10, 20]: media 12; desviación poblacional 4, muestral ≈ 4.47.
    // El 20 queda a 2 desviaciones poblacionales (8) pero sólo a ≈1.79 muestrales.
    const rows = [{ v: 10 }, { v: 10 }, { v: 10 }, { v: 10 }, { v: 20 }]
    const flaggedAt = (threshold: number) => flagOutliers(rows, (r) => r.v, threshold).find((r) => r.v === 20)?.atipico
    expect(flaggedAt(1.9)).toBe(true)
    expect(flaggedAt(2.1)).toBe(false)
  })

  it("keeps the shared defaults the anomaly detector relies on", () => {
    expect(DEFAULT_OUTLIER_THRESHOLD_STDDEVS).toBe(1.5)
    expect(MIN_CONCLUSIVE_SAMPLE).toBe(5)
  })
})

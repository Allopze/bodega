import { describe, expect, it } from "vitest"
import {
  buildPerformanceGlossary,
  buildPerformanceStats,
  formatKpi,
  type PerformanceMetrics,
} from "./performance-stats"

const METRICS: PerformanceMetrics = { availabilityPercent: 95.5 }

describe("buildPerformanceStats", () => {
  it("shows availability only when the user can view fleet", () => {
    expect(buildPerformanceStats(METRICS, { canViewFleet: true }).map((stat) => stat.key)).toEqual(["availability"])
    expect(buildPerformanceStats(METRICS, { canViewFleet: false })).toEqual([])
  })

  it("shows missing data as text and applies the documented warning thresholds", () => {
    const missing = buildPerformanceStats({ availabilityPercent: null }, { canViewFleet: true })[0]!
    expect(missing).toMatchObject({ value: "Sin datos", valueKind: "text" })

    const warning = buildPerformanceStats({ availabilityPercent: 85 }, { canViewFleet: true })[0]!
    expect(warning).toMatchObject({ tone: "signal", hint: "Bajo 90%" })
    const critical = buildPerformanceStats({ availabilityPercent: 79 }, { canViewFleet: true })[0]!
    expect(critical).toMatchObject({ tone: "danger", hint: "Bajo 80%" })
  })
})

describe("formatKpi", () => {
  it("formats the requested suffix and precision", () => {
    expect(formatKpi(92.34, "%")).toBe("92,3%")
    expect(formatKpi(450.4, " h", 0)).toBe("450 h")
  })
  it("formats null as missing data", () => {
    expect(formatKpi(null, "%")).toBe("Sin datos")
  })
})

describe("buildPerformanceGlossary", () => {
  it("describes the visible availability indicator only", () => {
    expect(buildPerformanceGlossary({ canViewFleet: true }).map((entry) => entry.key)).toEqual(["availability"])
    expect(buildPerformanceGlossary({ canViewFleet: false })).toEqual([])
  })
})

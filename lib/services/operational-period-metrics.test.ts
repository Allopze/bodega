import { describe, expect, it } from "vitest"
import { buildOperationalPeriodComparison, getOperationalCalendarBounds } from "./operational-period-metrics"

describe("operational period metrics", () => {
  it("uses the Chile calendar month at a UTC month boundary", () => {
    const bounds = getOperationalCalendarBounds(new Date("2026-07-01T02:30:00.000Z"))

    expect(bounds.currentStart).toBe("2026-06-01T00:00:00.000Z")
    expect(bounds.currentEnd).toBe("2026-07-01T00:00:00.000Z")
    expect(bounds.previousStart).toBe("2026-05-01T00:00:00.000Z")
  })

  it("does not manufacture a comparison before there is historical coverage", () => {
    expect(buildOperationalPeriodComparison(4, 0, 0)).toEqual({ current: 4, previous: null })
    expect(buildOperationalPeriodComparison(4, 0, 2)).toEqual({ current: 4, previous: 0 })
  })
})

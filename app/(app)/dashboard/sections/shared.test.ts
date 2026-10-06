import { afterEach, describe, expect, it, vi } from "vitest"
import { analyticsFilters } from "./shared"
import type { DashboardScope } from "../dashboard-scope"

const scope = (period: DashboardScope["period"]): DashboardScope => ({
  worksiteId: "all", worksiteName: null, period, view: "finanzas",
})

describe("analyticsFilters", () => {
  afterEach(() => vi.useRealTimers())

  // INI-01: `currentEnd` es exclusivo y analítica filtra con un rango inclusivo.
  // Pasarlo tal cual sumaba el primer día del período siguiente.
  it("el fin del rango es el último día del período, no el primero del siguiente", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-05T15:00:00.000Z"))

    expect(analyticsFilters(scope("mes"))).toMatchObject({ fromDate: "2026-10-01", toDate: "2026-10-31" })
    expect(analyticsFilters(scope("trimestre"))).toMatchObject({ fromDate: "2026-10-01", toDate: "2026-12-31" })
    expect(analyticsFilters(scope("anio"))).toMatchObject({ fromDate: "2026-01-01", toDate: "2026-12-31" })
  })

  it("agrega la faena sólo cuando el alcance la fija", () => {
    expect(analyticsFilters(scope("mes"))).not.toHaveProperty("worksiteId")
    expect(analyticsFilters({ ...scope("mes"), worksiteId: "ws-1", worksiteName: "Norte" })).toHaveProperty("worksiteId", "ws-1")
  })
})

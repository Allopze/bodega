import { describe, expect, it, vi } from "vitest"
import { calculateOperationalControlMetrics, resolveOperationalControlPeriod } from "@/lib/services/operational-control"

describe("resolveOperationalControlPeriod", () => {
  it("conserva un rango civil válido", () => {
    expect(resolveOperationalControlPeriod({ from: "2026-01-01", to: "2026-03-31" }))
      .toEqual({ from: "2026-01-01", to: "2026-03-31" })
  })

  it("rechaza rangos invertidos", () => {
    expect(() => resolveOperationalControlPeriod({ from: "2026-04-01", to: "2026-03-31" }))
      .toThrow("El inicio del período no puede ser posterior al término")
  })

  it("usa el día chileno y 90 días cuando el rango es inválido", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-23T02:30:00Z"))
    expect(resolveOperationalControlPeriod({ from: "2026-02-31", to: "sin-fecha" }))
      .toEqual({ from: "2026-05-25", to: "2026-08-22" })
    vi.useRealTimers()
  })
})

describe("calculateOperationalControlMetrics", () => {
  it("calcula MTTR sólo con la detención de correctivas completadas", () => {
    expect(calculateOperationalControlMetrics({
      totalIntervalHours: 1_000,
      operativeHours: 900,
      downtimeHours: 140,
      correctiveDowntimeHours: 40,
      completedCorrective: 2,
      preventiveCompleted: 8,
      preventiveDue: 10,
      backlog: 3,
      maintenanceCost: 500_000,
      canViewCosts: true,
    })).toMatchObject({
      mttrHours: 20,
      mtbfHours: 450,
      downtimeHours: 140,
    })
  })
})

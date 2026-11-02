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
  it("calcula disponibilidad y cobertura de estado", () => {
    expect(calculateOperationalControlMetrics({
      totalIntervalHours: 1_000,
      calendarHours: 2_000,
      operativeHours: 900,
    })).toEqual({
      availabilityPercent: 90,
      stateCoveragePercent: 50,
    })
  })

  it("devuelve null sin horas registradas", () => {
    expect(calculateOperationalControlMetrics({
      totalIntervalHours: 0,
      calendarHours: 2_000,
      operativeHours: 0,
    })).toEqual({
      availabilityPercent: null,
      stateCoveragePercent: null,
    })
  })

  it("acota disponibilidad y cobertura a 100 con intervalos solapados", () => {
    const metrics = calculateOperationalControlMetrics({
      totalIntervalHours: 1_000,
      calendarHours: 900,
      operativeHours: 1_200,
    })

    expect(metrics.availabilityPercent).toBe(100)
    expect(metrics.stateCoveragePercent).toBe(100)
  })
})

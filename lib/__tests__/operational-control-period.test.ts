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
      calendarHours: 2_000,
      operativeHours: 900,
      downtimeHours: 140,
      correctiveDowntimeHours: 40,
      completedCorrective: 2,
      preventiveCompleted: 8,
      preventiveDue: 10,
      backlog: 3,
      maintenanceCost: 500_000,
      maintenanceCostApproved: 300_000,
      plansDue: 4,
      plansWithRecord: 3,
      overdueSla: 1,
      unassignedOpen: 2,
      canViewCosts: true,
    })).toMatchObject({
      mttrHours: 20,
      mtbfHours: 450,
      downtimeHours: 140,
      stateCoveragePercent: 50,
      maintenanceCostApproved: 300_000,
      planAdherencePercent: 75,
      overdueSla: 1,
      unassignedOpen: 2,
    })
  })

  it("acota disponibilidad y cobertura a 100 con intervalos solapados", () => {
    const metrics = calculateOperationalControlMetrics({
      totalIntervalHours: 1_000,
      calendarHours: 900,
      operativeHours: 1_200,
      downtimeHours: 0,
      correctiveDowntimeHours: 0,
      completedCorrective: 0,
      preventiveCompleted: 0,
      preventiveDue: 0,
      backlog: 0,
      maintenanceCost: 0,
      maintenanceCostApproved: 0,
      plansDue: 0,
      plansWithRecord: 0,
      overdueSla: 0,
      unassignedOpen: 0,
      canViewCosts: true,
    })

    expect(metrics.availabilityPercent).toBe(100)
    expect(metrics.stateCoveragePercent).toBe(100)
  })
})

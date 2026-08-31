import { describe, expect, it } from "vitest"
import { DEFAULT_SCHEDULE_HORIZON, derivePdtpScheduleSource, deriveScheduleHorizon, describePdtpRecurrence, describePdtpRecurrenceImpact, diffScheduleCells, projectRecurrenceToLegacySchedule, recurrenceRulesEqual, scheduleCellsFingerprint } from "@/lib/services/pdtp/recurrence"
import { pdtpRecurrenceRuleSchema } from "@/lib/validation/prevention-module/pdtp"

describe("PDTP recurrence rules", () => {
  it("projects a monthly rule without exposing the matrix as authoring input", () => {
    const cells = projectRecurrenceToLegacySchedule({
      frequency: "monthly",
      interval: 1,
      plannedQuantity: 2,
      weekOfMonth: 2,
    })

    expect(cells).toHaveLength(12)
    expect(cells[0]).toEqual({ month: 1, week: 2, plannedQuantity: 2 })
    expect(cells[11]).toEqual({ month: 12, week: 2, plannedQuantity: 2 })
    expect(describePdtpRecurrence({ frequency: "monthly", interval: 1, plannedQuantity: 2, weekOfMonth: 2 }))
      .toContain("Genera 12 obligación(es)")
  })

  it("supports quarterly, annual and selected-month rules", () => {
    expect(projectRecurrenceToLegacySchedule({ frequency: "quarterly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 }).map((cell) => cell.month))
      .toEqual([1, 4, 7, 10])
    expect(projectRecurrenceToLegacySchedule({ frequency: "annual", interval: 1, plannedQuantity: 1, weekOfMonth: 3 }))
      .toEqual([{ month: 1, week: 3, plannedQuantity: 1 }])
    expect(projectRecurrenceToLegacySchedule({ frequency: "custom", interval: 1, plannedQuantity: 1, months: [12, 3, 3, 8], weekOfMonth: 4 }).map((cell) => cell.month))
      .toEqual([3, 8, 12])
  })

  it("rejects a custom recurrence without selected months", () => {
    expect(pdtpRecurrenceRuleSchema.safeParse({ frequency: "custom" }).success).toBe(false)
    expect(pdtpRecurrenceRuleSchema.safeParse({ frequency: "custom", months: [] }).success).toBe(false)
    expect(pdtpRecurrenceRuleSchema.safeParse({ frequency: "custom", months: [3] }).success).toBe(true)
  })

  it("applies an interval to weekly compatibility projections", () => {
    const cells = projectRecurrenceToLegacySchedule({ frequency: "weekly", interval: 2, plannedQuantity: 1, weekOfMonth: 1 })
    expect(cells).toHaveLength(24)
    expect(cells.slice(0, 3)).toEqual([
      { month: 1, week: 1, plannedQuantity: 1 },
      { month: 1, week: 3, plannedQuantity: 1 },
      { month: 2, week: 1, plannedQuantity: 1 },
    ])
  })

  it("shows the obligation impact before changing an existing recurrence", () => {
    expect(describePdtpRecurrenceImpact(
      "scheduled",
      { frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
      "scheduled",
      { frequency: "quarterly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 },
    )).toEqual({ currentCount: 12, nextCount: 4, changed: true })
  })

  it("derives the full calendar year when a program has no declared period (2026 regression)", () => {
    expect(deriveScheduleHorizon({ year: 2026 })).toEqual({ months: Array.from({ length: 12 }, (_, i) => i + 1), weeksPerMonth: 4 })
  })

  it("bounds the horizon to a partial-year period without fabricating months outside it", () => {
    const horizon = deriveScheduleHorizon({ year: 2027, periodStart: "2027-04-01", periodEnd: "2027-09-30" })
    expect(horizon.months).toEqual([4, 5, 6, 7, 8, 9])

    const cells = projectRecurrenceToLegacySchedule({ frequency: "monthly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 }, horizon)
    expect(cells).toHaveLength(6)
    expect(cells.map((cell) => cell.month)).toEqual([4, 5, 6, 7, 8, 9])
  })

  it("respects a custom weeksPerMonth for weekly projections", () => {
    const horizon = { months: [1, 2], weeksPerMonth: 2 }
    const cells = projectRecurrenceToLegacySchedule({ frequency: "weekly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 }, horizon)
    expect(cells).toHaveLength(4)
    expect(cells.every((cell) => cell.week <= 2)).toBe(true)
  })

  it("still yields exactly 48 cells for the annual 2026 case (regression)", () => {
    const horizon = deriveScheduleHorizon({ year: 2026 })
    const cells = projectRecurrenceToLegacySchedule({ frequency: "weekly", interval: 1, plannedQuantity: 1, weekOfMonth: 1 }, horizon)
    expect(cells).toHaveLength(48)
  })
})

describe("PDTP schedule source derivation", () => {
  const MONTHLY = { frequency: "monthly" as const, interval: 1, plannedQuantity: 1, weekOfMonth: 2 }

  it("recurrenceRulesEqual ignora el orden de claves y la forma numérica, pero distingue meses", () => {
    // jsonb no conserva el orden de claves ni `1` frente a `1.0`; comparar con
    // JSON.stringify daría un falso "cambió" y dispararía la re-proyección.
    expect(recurrenceRulesEqual(
      { weekOfMonth: 2, plannedQuantity: 1.0, interval: 1, frequency: "monthly" },
      MONTHLY,
    )).toBe(true)
    expect(recurrenceRulesEqual(
      { frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [8, 3] },
      { frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [3, 8] },
    )).toBe(true)
    expect(recurrenceRulesEqual(
      { frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [3, 8] },
      { frequency: "custom", interval: 1, plannedQuantity: 1, weekOfMonth: 1, months: [3, 9] },
    )).toBe(false)
    expect(recurrenceRulesEqual(MONTHLY, { ...MONTHLY, weekOfMonth: 3 })).toBe(false)
    expect(recurrenceRulesEqual(null, null)).toBe(true)
    expect(recurrenceRulesEqual(MONTHLY, null)).toBe(false)
  })

  it("scheduleCellsFingerprint ignora el orden y trata ausencia igual que cero", () => {
    const a = scheduleCellsFingerprint([
      { month: 3, week: 2, plannedQuantity: 1 },
      { month: 1, week: 1, plannedQuantity: 2 },
    ])
    const b = scheduleCellsFingerprint([
      { month: 1, week: 1, plannedQuantity: 2 },
      { month: 2, week: 4, plannedQuantity: 0 },
      { month: 3, week: 2, plannedQuantity: 1 },
    ])
    expect(a).toBe(b)
    expect(scheduleCellsFingerprint([])).toBe("")
    expect(scheduleCellsFingerprint([{ month: 1, week: 1, plannedQuantity: 0 }])).toBe("")
  })

  it("diffScheduleCells separa altas, bajas, cambios y totales planificados", () => {
    const diff = diffScheduleCells(
      [{ month: 1, week: 1, plannedQuantity: 2 }, { month: 2, week: 1, plannedQuantity: 1 }],
      [{ month: 1, week: 1, plannedQuantity: 3 }, { month: 3, week: 1, plannedQuantity: 1 }],
    )
    expect(diff.addedCells).toEqual([{ month: 3, week: 1, plannedQuantity: 1 }])
    expect(diff.removedCells).toEqual([{ month: 2, week: 1, plannedQuantity: 1 }])
    expect(diff.changedCells).toEqual([{ month: 1, week: 1, from: 2, to: 3 }])
    expect(diff.currentPlannedTotal).toBe(3)
    expect(diff.nextPlannedTotal).toBe(4)
  })

  it("derivePdtpScheduleSource distingue proyección de la regla y ajuste manual", () => {
    const horizon = DEFAULT_SCHEDULE_HORIZON
    const projected = projectRecurrenceToLegacySchedule(MONTHLY, horizon)
    const base = { scheduleMode: "scheduled" as const, recurrenceRule: MONTHLY, horizon }

    expect(derivePdtpScheduleSource({ ...base, cells: projected })).toBe("rule")
    expect(derivePdtpScheduleSource({ ...base, cells: [] })).toBe("none")
    expect(derivePdtpScheduleSource({ ...base, cells: projected.slice(1) })).toBe("manual")
    expect(derivePdtpScheduleSource({ ...base, cells: [...projected, { month: 6, week: 4, plannedQuantity: 1 }] })).toBe("manual")
    expect(derivePdtpScheduleSource({
      ...base,
      cells: projected.map((cell, index) => (index === 0 ? { ...cell, plannedQuantity: 5 } : cell)),
    })).toBe("manual")
    // Celdas heredadas de la importación: no hay regla que las explique.
    expect(derivePdtpScheduleSource({ ...base, recurrenceRule: null, cells: projected })).toBe("manual")
    expect(derivePdtpScheduleSource({ ...base, scheduleMode: "on_demand", cells: projected })).toBe("manual")
  })

  it("el horizonte forma parte del criterio: las mismas celdas son regla o manual según el período", () => {
    const partial = deriveScheduleHorizon({ year: 2026, periodStart: "2026-04-01", periodEnd: "2026-09-30" })
    const cells = projectRecurrenceToLegacySchedule(MONTHLY, partial)
    expect(cells).toHaveLength(6)

    expect(derivePdtpScheduleSource({ cells, scheduleMode: "scheduled", recurrenceRule: MONTHLY, horizon: partial })).toBe("rule")
    expect(derivePdtpScheduleSource({ cells, scheduleMode: "scheduled", recurrenceRule: MONTHLY, horizon: DEFAULT_SCHEDULE_HORIZON })).toBe("manual")
  })
})

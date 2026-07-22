import { describe, expect, it } from "vitest"
import { describePdtpRecurrence, describePdtpRecurrenceImpact, projectRecurrenceToLegacySchedule } from "@/lib/services/pdtp/recurrence"

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
})

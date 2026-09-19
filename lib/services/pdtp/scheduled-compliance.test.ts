import { describe, expect, it } from "vitest"
import { calculatePdtpScheduledInstanceCompliance } from "@/lib/services/pdtp/scheduled-compliance"

describe("scheduled PDTP compliance", () => {
  it("counts each planned occurrence independently and caps over-completion", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      status: index === 11 ? "pending" : "completed",
      scheduledFor: `2027-${String(index + 1).padStart(2, "0")}-15`,
      completedAt: index === 11 ? null : `2027-${String(index + 1).padStart(2, "0")}-15T12:00:00.000Z`,
      plannedQuantity: 1,
    }))

    expect(calculatePdtpScheduledInstanceCompliance(rows)).toMatchObject({
      planned: 12,
      completed: 11,
      completedOnTime: 11,
      completedLate: 0,
      pending: 1,
      plannedVsCompleted: 11 / 12,
      closedOnTime: 11 / 12,
    })
  })

  it("excludes no aplica and cancelada while preserving their trace counts", () => {
    const result = calculatePdtpScheduledInstanceCompliance([
      { status: "completed", scheduledFor: "2027-01-01", completedAt: "2027-01-02T12:00:00.000Z", plannedQuantity: 1 },
      { status: "not_applicable", scheduledFor: "2027-02-01", completedAt: null, plannedQuantity: 1 },
      { status: "cancelled", scheduledFor: "2027-03-01", completedAt: null, plannedQuantity: 2 },
      { status: "submitted", scheduledFor: "2027-04-01", completedAt: null, plannedQuantity: 1 },
      { status: "in_progress", scheduledFor: "2027-05-01", completedAt: null, plannedQuantity: 1 },
    ])

    expect(result).toMatchObject({
      planned: 3,
      completed: 1,
      completedOnTime: 0,
      completedLate: 1,
      notApplicable: 1,
      cancelled: 2,
      pending: 2,
      plannedVsCompleted: 1 / 3,
      closedOnTime: 0,
    })
  })
})

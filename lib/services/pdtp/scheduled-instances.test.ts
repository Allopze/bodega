import { describe, expect, it } from "vitest"
import {
  buildPdtpScheduledInstanceRows,
  derivePdtpScheduledInstanceStatus,
  pdtpScheduledInstanceIdempotencyKey,
} from "@/lib/services/pdtp/scheduled-instances"

describe("PDTP scheduled instances", () => {
  it("builds one independent occurrence per date and worksite", () => {
    const rows = buildPdtpScheduledInstanceRows({
      program: { id: "program-1", periodStart: "2027-01-01", periodEnd: "2027-03-31" },
      activity: {
        id: "activity-1",
        programId: "program-1",
        scheduleDefinition: {
          version: 1,
          kind: "recurring",
          startDate: "2027-01-01",
          endDate: "2027-12-31",
          every: 1,
          unit: "month",
          dayOfMonth: 15,
        },
        responsibleSlugs: ["prevencionista"],
      },
      worksiteIds: ["ws-a", "ws-b"],
    })

    expect(rows).toHaveLength(6)
    expect(rows[0]).toMatchObject({
      activityId: "activity-1",
      worksiteId: "ws-a",
      scheduledFor: "2027-01-15",
      isoWeekYear: 2027,
      isoWeek: 2,
      responsibleSlug: "prevencionista",
      status: "pending",
    })
    expect(rows[0]?.idempotencyKey).toBe(pdtpScheduledInstanceIdempotencyKey("activity-1", "ws-a", "2027-01-15"))
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(rows.length)
  })

  it("does not materialize legacy-grid, event or on-demand definitions", () => {
    const rows = buildPdtpScheduledInstanceRows({
      program: { id: "program-1", periodStart: "2027-01-01", periodEnd: "2027-12-31" },
      activity: { id: "activity-1", programId: "program-1", scheduleDefinition: { version: 1, kind: "legacy_grid" }, responsibleSlugs: [] },
      worksiteIds: ["ws-a"],
    })
    expect(rows).toEqual([])
  })

  it("derives overdue and completed-late without persisting extra states", () => {
    expect(derivePdtpScheduledInstanceStatus({ status: "pending", scheduledFor: "2027-01-10", now: "2027-01-11T00:00:00.000Z" })).toBe("overdue")
    expect(derivePdtpScheduledInstanceStatus({ status: "completed", scheduledFor: "2027-01-10", completedAt: "2027-01-11T00:00:00.000Z", now: "2027-01-12T00:00:00.000Z" })).toBe("completed_late")
    expect(derivePdtpScheduledInstanceStatus({ status: "completed", scheduledFor: "2027-01-10", completedAt: "2027-01-10T12:00:00.000Z", now: "2027-01-12T00:00:00.000Z" })).toBe("completed")
  })
})

import { describe, expect, it } from "vitest"
import {
  pdtpActivityExecutionConfigSchema,
  pdtpReminderRuleSchema,
  pdtpScheduleDefinitionSchema,
} from "@/lib/validation/prevention-module/pdtp"

describe("PDTP schedule and execution configuration validation", () => {
  it("accepts an exact date and a configurable recurrence", () => {
    expect(pdtpScheduleDefinitionSchema.safeParse({ version: 1, kind: "one_time", date: "2027-05-15" }).success).toBe(true)
    expect(pdtpScheduleDefinitionSchema.safeParse({
      version: 1, kind: "recurring", startDate: "2027-01-01", endDate: "2027-12-31",
      every: 3, unit: "month", dayOfMonth: 31, plannedQuantity: 1,
    }).success).toBe(true)
  })

  it("requires a supported connector event for event schedules", () => {
    expect(pdtpScheduleDefinitionSchema.safeParse({
      version: 1, kind: "event", triggerConnectorKey: "worker", triggerEventKey: "worker_created", dueValue: 24, dueUnit: "hour",
    }).success).toBe(true)
    expect(pdtpScheduleDefinitionSchema.safeParse({
      version: 1, kind: "event", triggerConnectorKey: "", triggerEventKey: "", dueValue: 0, dueUnit: "day",
    }).success).toBe(false)
  })

  it("validates completion/evidence policy and reminder offsets", () => {
    expect(pdtpActivityExecutionConfigSchema.safeParse({
      destinationConnectorKey: "inspections",
      accreditationBindingId: null,
      completionPolicy: "checklist_completed",
      evidencePolicy: { required: true, acceptedKinds: ["checklist", "photo"] },
    }).success).toBe(true)
    expect(pdtpActivityExecutionConfigSchema.safeParse({
      destinationConnectorKey: "inspections",
      completionPolicy: "source_completed",
      evidencePolicy: { required: true, acceptedKinds: [] },
    }).success).toBe(false)
    expect(pdtpReminderRuleSchema.safeParse({ offsetValue: -5, offsetUnit: "day" }).success).toBe(true)
    expect(pdtpReminderRuleSchema.safeParse({ offsetValue: 0, offsetUnit: "week" }).success).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import { pdtpReminderTargetAt } from "@/lib/services/pdtp/scheduled-reminders"

describe("scheduled PDTP reminders", () => {
  it("calculates offsets from the civil scheduled date", () => {
    expect(pdtpReminderTargetAt("2027-05-15", -5, "day")).toBe("2027-05-10T12:00:00.000Z")
    expect(pdtpReminderTargetAt("2027-05-15", 3, "hour")).toBe("2027-05-15T15:00:00.000Z")
  })
})

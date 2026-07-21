import { describe, expect, it } from "vitest"
import { shouldSendDocumentAckReminder } from "@/lib/services/prevention-document-ack-reminders"

describe("document acknowledgment reminder cadence", () => {
  const now = new Date("2026-07-18T12:00:00.000Z")

  it("sends the first reminder and repeats pending assignments every three days", () => {
    expect(shouldSendDocumentAckReminder({ now, lastReminderAt: null, dueAt: "2026-07-25T00:00:00.000Z" })).toBe(true)
    expect(shouldSendDocumentAckReminder({ now, lastReminderAt: "2026-07-16T12:00:00.000Z", dueAt: "2026-07-25T00:00:00.000Z" })).toBe(false)
    expect(shouldSendDocumentAckReminder({ now, lastReminderAt: "2026-07-15T12:00:00.000Z", dueAt: "2026-07-25T00:00:00.000Z" })).toBe(true)
  })

  it("repeats overdue reminders daily and undated reminders weekly", () => {
    expect(shouldSendDocumentAckReminder({ now, lastReminderAt: "2026-07-17T12:00:00.000Z", dueAt: "2026-07-10T00:00:00.000Z" })).toBe(true)
    expect(shouldSendDocumentAckReminder({ now, lastReminderAt: "2026-07-12T12:00:00.000Z", dueAt: null })).toBe(false)
    expect(shouldSendDocumentAckReminder({ now, lastReminderAt: "2026-07-11T12:00:00.000Z", dueAt: null })).toBe(true)
  })
})

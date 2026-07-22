import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  alreadyRecorded: false,
  candidates: vi.fn(),
  recipients: vi.fn(),
  createNotifications: vi.fn(),
  record: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => mocks.alreadyRecorded ? [{ id: "reminder-1" }] : []),
        })),
      })),
    })),
  },
}))

vi.mock("@/lib/services/notifications", () => ({
  getUserIdsWithPermissionForWorksite: mocks.recipients,
  createNotifications: mocks.createNotifications,
}))

vi.mock("./obligations", () => ({
  listPdtpObligationReminderCandidates: mocks.candidates,
  recordPdtpObligationReminder: mocks.record,
}))

import { runPdtpObligationReminders } from "./reminders"

describe("runPdtpObligationReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.alreadyRecorded = false
    mocks.candidates.mockResolvedValue([{
      obligation: { id: "obligation-1", worksiteId: "ws-1" },
      activityNumber: 12,
      activityName: "Investigar evento",
      worksiteName: "Faena Norte",
      window: "due_1d",
    }])
    mocks.recipients.mockResolvedValue(["user-1"])
    mocks.createNotifications.mockResolvedValue(undefined)
    mocks.record.mockImplementation(async () => {
      mocks.alreadyRecorded = true
      return { reminder: { id: "reminder-1" }, created: true }
    })
  })

  it("notifies scoped executors once per obligation, recipient and window", async () => {
    await expect(runPdtpObligationReminders(new Date("2026-07-21T12:00:00.000Z"))).resolves.toEqual({
      candidates: 1,
      notificationsCreated: 1,
      notifiedUsers: 1,
    })
    expect(mocks.recipients).toHaveBeenCalledWith("prevention:pdtp:execute", "ws-1")
    expect(mocks.createNotifications).toHaveBeenCalledWith(["user-1"], expect.objectContaining({
      entityHref: "/prevencion/pdtp/obligaciones",
      dedupeKey: "pdtp-obligation:obligation-1:user-1:due_1d",
    }))

    await expect(runPdtpObligationReminders(new Date("2026-07-21T12:05:00.000Z"))).resolves.toEqual({
      candidates: 1,
      notificationsCreated: 0,
      notifiedUsers: 0,
    })
    expect(mocks.createNotifications).toHaveBeenCalledTimes(1)
    expect(mocks.record).toHaveBeenCalledTimes(1)
  })
})

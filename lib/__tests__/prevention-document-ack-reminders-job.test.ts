import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRows = vi.hoisted(() => [] as Array<Record<string, unknown>>)
const mockCreateNotifications = vi.hoisted(() => vi.fn())
const mockManagers = vi.hoisted(() => vi.fn())
const mockUpdateWhere = vi.hoisted(() => vi.fn())
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: mockUpdateWhere })))

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          innerJoin: vi.fn(() => ({ where: vi.fn(async () => mockRows) })),
        })),
      })),
    })),
    update: vi.fn(() => ({ set: mockUpdateSet })),
  },
}))
vi.mock("@/lib/services/notifications", () => ({
  createNotifications: mockCreateNotifications,
  getUserIdsWithPermissionForWorksite: mockManagers,
}))

import { runPreventionDocumentAckReminders } from "@/lib/services/prevention-document-ack-reminders"

describe("document acknowledgment reminder job", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRows.length = 0
    mockCreateNotifications.mockResolvedValue(undefined)
    mockManagers.mockResolvedValue(["manager-1"])
  })

  it("notifies the nominated recipient, escalates overdue work and records cadence", async () => {
    mockRows.push({
      target: {
        id: "target-1", versionId: "version-1", userId: "recipient-1", workerId: null,
        worksiteId: "ws-1", status: "pendiente", dueAt: "2026-07-10T00:00:00.000Z",
        lastReminderAt: null, reminderCount: 0,
      },
      documentId: "doc-1",
      documentTitle: "Procedimiento crítico",
      documentWorksiteId: "ws-1",
      checksum: "a".repeat(64),
    })

    const result = await runPreventionDocumentAckReminders(new Date("2026-07-18T12:00:00.000Z"))

    expect(result).toEqual({ pendingTargets: 1, remindersSent: 1, overdueTargets: 1, escalatedTargets: 1, notifiedUsers: 2, errors: 0 })
    expect(mockCreateNotifications).toHaveBeenCalledWith(["recipient-1"], expect.objectContaining({
      dedupeKey: "document-ack-reminder:target-1:2026-07-18",
    }))
    expect(mockCreateNotifications).toHaveBeenCalledWith(["manager-1"], expect.objectContaining({
      dedupeKey: "document-ack-overdue:target-1:2026-07-18",
    }))
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ lastReminderAt: "2026-07-18T12:00:00.000Z" }))
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSelect = vi.hoisted(() => vi.fn())
const mockCreateNotifications = vi.hoisted(() => vi.fn())
const mockTargets = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: { select: mockSelect } }))
vi.mock("@/lib/services/notifications", () => ({
  createNotifications: mockCreateNotifications,
  getUserIdsWithPermissionForWorksite: mockTargets,
}))

import { runPreventionCapaReminders } from "@/lib/services/prevention-capa-reminders"

function selectRows(rows: unknown[]) {
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mockCreateNotifications.mockResolvedValue(undefined)
  mockTargets.mockImplementation(async (permission: string) => {
    if (permission === "prevention:capa:manage") return ["manager-1"]
    if (permission === "prevention:capa:verify") return ["verifier-1"]
    if (permission === "prevention:capa:close") return ["chief-1"]
    return []
  })
})

describe("CAPA reminders", () => {
  it("notifies the verifier for an implementation waiting for verification", async () => {
    selectRows([{
      id: "c1", code: "CAPA-1", worksiteId: "w1", status: "pending_verification",
      targetDate: "2099-01-01", version: 4, priority: "medium", responsibleUserId: "owner-1",
    }])
    const result = await runPreventionCapaReminders()
    expect(result).toEqual({ assignedActions: 1, overdueActions: 0, pendingVerificationActions: 1, notifiedUsers: 2 })
    expect(mockCreateNotifications).toHaveBeenCalledWith(["owner-1"], expect.objectContaining({
      dedupeKey: "capa-assigned:c1:owner-1:2099-01-01",
    }))
    expect(mockCreateNotifications).toHaveBeenCalledWith(["verifier-1"], expect.objectContaining({
      dedupeKey: "capa-pending-verification:c1:v4",
    }))
  })

  it("notifies owner/manager and escalates a high overdue action", async () => {
    selectRows([{
      id: "c2", code: "CAPA-2", worksiteId: "w1", status: "in_progress",
      targetDate: "2000-01-01", version: 2, priority: "high", responsibleUserId: "owner-1",
    }])
    const result = await runPreventionCapaReminders()
    expect(result.assignedActions).toBe(1)
    expect(result.overdueActions).toBe(1)
    expect(result.notifiedUsers).toBe(3)
    expect(mockCreateNotifications).toHaveBeenCalledWith(
      expect.arrayContaining(["owner-1", "manager-1"]),
      expect.objectContaining({ dedupeKey: "capa-overdue:c2:2000-01-01:owner" }),
    )
    expect(mockCreateNotifications).toHaveBeenCalledWith(["chief-1"], expect.objectContaining({
      dedupeKey: "capa-overdue:c2:2000-01-01:escalation",
    }))
  })
})

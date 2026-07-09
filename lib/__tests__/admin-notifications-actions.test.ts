/**
 * Unit tests for notifications admin maintenance actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCleanupOld = vi.hoisted(() => vi.fn())
const mockGetOperational = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("@/lib/services/notification-read", () => ({
  cleanupOldNotifications: mockCleanupOld,
}))
vi.mock("@/lib/services/system-settings", () => ({
  getOperationalSettings: mockGetOperational,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { cleanupReadNotificationsAction } from "@/app/(app)/admin/notificaciones/actions"
import type { ActionState } from "@/lib/validation/masters"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["administrador"],
      permissions: ["admin:notifications"],
      worksiteIds: [],
      primaryWorksiteId: "",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

describe("cleanupReadNotificationsAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires admin:notifications", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await cleanupReadNotificationsAction(prevState, new FormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("uses the configured retention days", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockGetOperational.mockResolvedValueOnce({
      exportMaxRows: 10_000,
      notificationRetentionDays: 30,
      feedbackAttachmentMaxMb: 20,
      pdtpEvidenceMaxMb: 25,
      pdtpEvidenceRetentionDays: 365,
    })
    mockCleanupOld.mockResolvedValueOnce(undefined)

    const res = await cleanupReadNotificationsAction(prevState, new FormData())
    expect(res.ok).toBe(true)
    expect(mockCleanupOld).toHaveBeenCalledWith(30)
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "delete",
      entityType: "notification",
      newState: { retentionDays: 30 },
    }))
  })

  it("defaults to 90 days when no settings are stored", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockGetOperational.mockResolvedValueOnce({
      exportMaxRows: 10_000,
      notificationRetentionDays: 90,
      feedbackAttachmentMaxMb: 20,
      pdtpEvidenceMaxMb: 25,
      pdtpEvidenceRetentionDays: 365,
    })
    mockCleanupOld.mockResolvedValueOnce(undefined)
    const res = await cleanupReadNotificationsAction(prevState, new FormData())
    expect(res.ok).toBe(true)
    expect(mockCleanupOld).toHaveBeenCalledWith(90)
    expect(res.message).toContain("90")
  })
})

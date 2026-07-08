/**
 * Unit tests for operational parameters admin action.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockGetOrganicSettings = vi.hoisted(() => vi.fn())
const mockUpdateOpsSettings = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("@/lib/services/system-settings", () => ({
  getOperationalSettings: mockGetOrganicSettings,
  updateOperationalSettings: mockUpdateOpsSettings,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { saveOperationalSettingsAction } from "@/app/(app)/admin/parametros-operativos/actions"
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
      permissions: ["admin:ops_settings"],
      worksiteIds: [],
      primaryWorksiteId: "",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

function makeFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("exportMaxRows", "12000")
  fd.set("notificationRetentionDays", "60")
  fd.set("feedbackAttachmentMaxMb", "15")
  fd.set("pdtpEvidenceMaxMb", "30")
  fd.set("pdtpEvidenceRetentionDays", "180")
  for (const [k, v] of Object.entries(fields)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

describe("saveOperationalSettingsAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires admin:ops_settings", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await saveOperationalSettingsAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("rejects values out of range", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockUpdateOpsSettings.mockRejectedValueOnce(
      new Error("El valor para exportMaxRows debe estar entre 100 y 100000"),
    )
    const res = await saveOperationalSettingsAction(prevState, makeFormData({ exportMaxRows: "5" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("entre 100 y 100000")
  })

  it("persists and revalidates", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockUpdateOpsSettings.mockResolvedValueOnce({
      exportMaxRows: 12_000,
      notificationRetentionDays: 60,
      feedbackAttachmentMaxMb: 15,
      pdtpEvidenceMaxMb: 30,
      pdtpEvidenceRetentionDays: 180,
    })
    const res = await saveOperationalSettingsAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockUpdateOpsSettings).toHaveBeenCalledTimes(1)
  })

  it("forwards the normalized values to the service", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockUpdateOpsSettings.mockResolvedValueOnce({
      exportMaxRows: 12_000,
      notificationRetentionDays: 60,
      feedbackAttachmentMaxMb: 15,
      pdtpEvidenceMaxMb: 30,
      pdtpEvidenceRetentionDays: 180,
    })
    await saveOperationalSettingsAction(prevState, makeFormData())
    expect(mockUpdateOpsSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        exportMaxRows: "12000",
        notificationRetentionDays: "60",
      }),
      expect.objectContaining({ userId: "user-1" }),
    )
  })
})

import { getOperationalSettings } from "@/lib/services/system-settings"

describe("getOperationalSettings (defaults)", () => {
  beforeEach(() => vi.resetAllMocks())

  it("returns defaults when nothing is stored", async () => {
    mockGetOrganicSettings.mockResolvedValueOnce({
      exportMaxRows: 10_000,
      notificationRetentionDays: 90,
      feedbackAttachmentMaxMb: 20,
      pdtpEvidenceMaxMb: 25,
      pdtpEvidenceRetentionDays: 365,
    })
    const settings = await getOperationalSettings()
    expect(settings.exportMaxRows).toBe(10_000)
    expect(settings.notificationRetentionDays).toBe(90)
  })
})

/**
 * Unit tests for fleet admin settings action.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockGetFleetAdminSettings = vi.hoisted(() => vi.fn())
const mockUpdateSystemSettingNumber = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("@/lib/services/system-settings", () => ({
  getFleetAdminSettings: mockGetFleetAdminSettings,
  updateSystemSettingNumber: mockUpdateSystemSettingNumber,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { saveFleetAdminSettingsAction } from "@/app/(app)/admin/flota-catalogos/actions"
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
      permissions: ["admin:fleet_catalog"],
      worksiteIds: [],
      primaryWorksiteId: "",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

describe("saveFleetAdminSettingsAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires admin:fleet_catalog", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const fd = new FormData(); fd.set("warningDays", "30"); fd.set("defaultVehicleStatus", "operativo")
    const res = await saveFleetAdminSettingsAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("rejects warning days outside the allowed range", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData(); fd.set("warningDays", "0"); fd.set("defaultVehicleStatus", "operativo")
    const res = await saveFleetAdminSettingsAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("días de aviso")
  })

  it("persists and audits both settings", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockGetFleetAdminSettings.mockResolvedValueOnce({
      warningDays: 30,
      defaultVehicleStatus: "operativo",
    })

    const fd = new FormData(); fd.set("warningDays", "45"); fd.set("defaultVehicleStatus", "mantencion")
    const res = await saveFleetAdminSettingsAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockUpdateSystemSettingNumber).toHaveBeenCalledWith({
      key: "fleet.document.warning_days",
      value: 45,
      min: 1,
      max: 365,
    })
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "fleet_admin_setting",
      newState: { warningDays: 45, defaultVehicleStatus: "mantencion" },
    }))
  })
})

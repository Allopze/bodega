import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockSignEquipmentReport = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  guardAuth: vi.fn(),
  guardPermission: mockGuardPermission,
}))

vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: mockResolveWorksiteScope,
}))

vi.mock("@/lib/services/prevention-equipment", () => ({
  createEquipmentReport: vi.fn(),
  reviewEquipmentReport: vi.fn(),
  createEquipmentChecklist: vi.fn(),
  closeEquipmentChecklist: vi.fn(),
  signEquipmentReport: mockSignEquipmentReport,
}))

vi.mock("@/lib/services/prevention-health", () => ({
  describeActiveRestrictions: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))

import { signEquipmentReportAction } from "@/app/(app)/prevencion/equipos/actions"

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "prev@example.test",
      name: "Prevencionista",
      roles: ["prevencionista"],
      permissions: ["prevention:equipment_reports:manage"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

describe("prevention equipment Server Actions", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGuardPermission.mockResolvedValue({ session: makeSession(), error: null })
    mockResolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-1"] })
    mockSignEquipmentReport.mockResolvedValue({ id: "edr-1", signedByWorkerId: "worker-1" })
  })

  it("signs an equipment report within the caller scope", async () => {
    const result = await signEquipmentReportAction("edr-1")

    expect(mockSignEquipmentReport).toHaveBeenCalledWith("edr-1", ["ws-1"])
    expect(mockRevalidatePath).toHaveBeenCalledWith("/prevencion/equipos/reportes")
    expect(result).toEqual({ ok: true, message: "Reporte firmado por el operador." })
  })

  it("returns permission errors without calling the service", async () => {
    mockGuardPermission.mockResolvedValueOnce({
      session: null,
      error: { ok: false, message: "Sin permisos" },
    })

    const result = await signEquipmentReportAction("edr-1")

    expect(result).toEqual({ ok: false, message: "Sin permisos" })
    expect(mockSignEquipmentReport).not.toHaveBeenCalled()
  })
})

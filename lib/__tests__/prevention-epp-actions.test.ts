import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardAuth = vi.hoisted(() => vi.fn())
const mockSetEppLifecyclePolicy = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  guardAuth: mockGuardAuth,
}))

vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: vi.fn(() => ({ mode: "some", ids: ["ws-1"] })),
}))

vi.mock("@/lib/services/prevention-epp-matrix", () => ({
  setEppPositionEntry: vi.fn(),
  logEppDelivery: vi.fn(),
  acknowledgeEppDelivery: vi.fn(),
  setEppLifecyclePolicy: mockSetEppLifecyclePolicy,
}))

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))

import { setEppLifecyclePolicyAction } from "@/app/(app)/prevencion/epp/matriz/actions"

function makeSession(permissions = ["prevention:epp_matrix:manage"]) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "prev@example.test",
      name: "Prevencionista",
      roles: ["prevencionista"],
      permissions,
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

describe("prevention EPP Server Actions", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGuardAuth.mockResolvedValue({ session: makeSession(), error: null })
    mockSetEppLifecyclePolicy.mockResolvedValue({ eppProductId: "epp-casco" })
  })

  it("sets an EPP lifecycle policy with manage permission", async () => {
    const input = {
      eppProductId: "epp-casco",
      lifespanDays: 180,
      maxReuses: 1,
      inspectionChecklist: { visual: true },
    }

    const result = await setEppLifecyclePolicyAction(input)

    expect(mockSetEppLifecyclePolicy).toHaveBeenCalledWith(input)
    expect(mockRevalidatePath).toHaveBeenCalledWith("/prevencion/epp/matriz")
    expect(result).toEqual({ ok: true, message: "Política de vida útil EPP guardada." })
  })

  it("rejects lifecycle policy updates without manage permission", async () => {
    mockGuardAuth.mockResolvedValueOnce({ session: makeSession([]), error: null })

    const result = await setEppLifecyclePolicyAction({
      eppProductId: "epp-casco",
      lifespanDays: 180,
      inspectionChecklist: {},
    })

    expect(result.ok).toBe(false)
    expect(mockSetEppLifecyclePolicy).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockRegisterAlcoholTest = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  guardPermission: mockGuardPermission,
}))

vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: mockResolveWorksiteScope,
}))

vi.mock("@/lib/services/prevention-alcohol-tests", () => ({
  registerAlcoholTest: mockRegisterAlcoholTest,
  markAlcoholTestSent: vi.fn(),
  suggestRandomWorkersForTest: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))

import { registerAlcoholTestAction } from "@/app/(app)/prevencion/alcotest/actions"

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "prev@example.test",
      name: "Prevencionista",
      roles: ["prevencionista"],
      permissions: ["prevention:alcohol_tests:manage"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000000",
      isActive: true,
    },
  }
}

describe("prevention alcotest Server Actions", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGuardPermission.mockResolvedValue({ session: makeSession(), error: null })
    mockResolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-1"] })
  })

  it("awaits registerAlcoholTest and returns the positive escalation warning", async () => {
    mockRegisterAlcoholTest.mockResolvedValue({
      id: "alc-1",
      worksiteId: "ws-1",
      result: "positivo",
    })

    const result = await registerAlcoholTestAction({
      worksiteId: "ws-1",
      testedWorkerId: "worker-1",
      shift: "diurno",
      result: "positivo",
    })

    expect(mockRegisterAlcoholTest).toHaveBeenCalledWith(expect.objectContaining({
      worksiteId: "ws-1",
      result: "positivo",
    }), "user-1", ["ws-1"])
    expect(mockRevalidatePath).toHaveBeenCalledWith("/prevencion/alcotest")
    expect(result).toEqual({
      ok: true,
      message: "Test positivo registrado. Escalar al prevencionista para suspender el turno.",
    })
  })

  it("returns service errors instead of reporting success", async () => {
    mockRegisterAlcoholTest.mockRejectedValue(new Error("Sin acceso a esta faena."))

    const result = await registerAlcoholTestAction({
      worksiteId: "ws-2",
      shift: "diurno",
      result: "negativo",
    })

    expect(result).toEqual({ ok: false, message: "Sin acceso a esta faena." })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})

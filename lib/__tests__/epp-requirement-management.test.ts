import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockUpdateEppRequirement = vi.hoisted(() => vi.fn())
const mockDeactivateEppRequirement = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockResolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/services/prevention-epp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/prevention-epp")>()
  return {
    ...actual,
    updateEppRequirement: mockUpdateEppRequirement,
    deactivateEppRequirement: mockDeactivateEppRequirement,
  }
})

const session = {
  user: { id: "user-1", permissions: ["prevention:epp:manage"] },
}

describe("updateEppRequirementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session, error: null })
    mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
    mockUpdateEppRequirement.mockResolvedValue({ id: "req-1" })
  })

  it("forwards validated update input to the service on success", async () => {
    const { updateEppRequirementAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")
    const res = await updateEppRequirementAction({ id: "req-1", enforcement: "blocking", reason: "Actualización por modificación de norma." })

    expect(res.ok).toBe(true)
    expect(mockUpdateEppRequirement).toHaveBeenCalledTimes(1)
    const [calledInput] = mockUpdateEppRequirement.mock.calls[0]!
    expect(calledInput).toMatchObject({ id: "req-1", enforcement: "blocking" })
  })

  it("rejects invalid input via parseZ boundary when reason is too short", async () => {
    const { updateEppRequirementAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")
    const res = await updateEppRequirementAction({ id: "req-1", reason: "corto" })

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.reason).toBeDefined()
    expect(mockUpdateEppRequirement).not.toHaveBeenCalled()
  })
})

describe("deactivateEppRequirementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session, error: null })
    mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
    mockDeactivateEppRequirement.mockResolvedValue({ id: "req-1", isActive: false })
  })

  it("forwards validated deactivation input to service on success", async () => {
    const { deactivateEppRequirementAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")
    const res = await deactivateEppRequirementAction({ id: "req-1", reason: "El cargo fue eliminado de la estructura organizativa." })

    expect(res.ok).toBe(true)
    expect(mockDeactivateEppRequirement).toHaveBeenCalledTimes(1)
    const [calledInput] = mockDeactivateEppRequirement.mock.calls[0]!
    expect(calledInput).toMatchObject({ id: "req-1", reason: "El cargo fue eliminado de la estructura organizativa." })
  })

  it("rejects when permission guard fails", async () => {
    mockGuardPermission.mockResolvedValue({
      session: null,
      error: { ok: false, message: "Sin permisos" },
    })
    const { deactivateEppRequirementAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")

    const res = await deactivateEppRequirementAction({ id: "req-1", reason: "Motivo suficiente para desactivar." })
    expect(res.ok).toBe(false)
    expect(mockDeactivateEppRequirement).not.toHaveBeenCalled()
  })
})

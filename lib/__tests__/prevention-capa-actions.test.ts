import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const mockAuth = vi.hoisted(() => vi.fn())
const mockTransition = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-capa", () => ({
  transitionCapaAction: mockTransition,
  addCapaEvidence: vi.fn(),
  addCapaFollowup: vi.fn(),
  updateCapaAction: vi.fn(),
  reconcileCapaAction: vi.fn(),
}))

function session(permissions: string[], worksiteIds = ["w1"]): Session {
  return {
    user: {
      id: "u1", name: "Usuario", email: "u@test.local", permissions,
      roles: ["prevencionista_faena"], worksiteIds, isGlobal: false,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as Session
}

beforeEach(() => {
  vi.resetAllMocks()
  mockTransition.mockResolvedValue({ id: "c1" })
})

describe("CAPA server actions", () => {
  it("rejects verification by direct call without the dedicated permission", async () => {
    mockAuth.mockResolvedValue(session(["prevention:capa:view", "prevention:capa:complete"]))
    const { transitionCapaActionAction } = await import("@/app/(app)/prevencion/capa/actions")
    const result = await transitionCapaActionAction({
      actionId: "c1", expectedVersion: 2, toStatus: "verified",
      reason: "Inspección correcta", effectivenessStatus: "effective",
      effectivenessAssessment: "Control observado en terreno",
    })
    expect(result.ok).toBe(false)
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it("passes the exact worksite scope to the service", async () => {
    mockAuth.mockResolvedValue(session(["prevention:capa:verify"], ["w1"]))
    const { transitionCapaActionAction } = await import("@/app/(app)/prevencion/capa/actions")
    const input = {
      actionId: "c1", expectedVersion: 2, toStatus: "verified" as const,
      reason: "Inspección correcta", effectivenessStatus: "effective" as const,
      effectivenessAssessment: "Control observado en terreno",
    }
    const result = await transitionCapaActionAction(input)
    expect(result.ok).toBe(true)
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      input,
      scope: { mode: "some", ids: ["w1"] },
      permissions: ["prevention:capa:verify"],
    }))
  })

  it("does not treat verify as permission to close", async () => {
    mockAuth.mockResolvedValue(session(["prevention:capa:verify"]))
    const { transitionCapaActionAction } = await import("@/app/(app)/prevencion/capa/actions")
    const result = await transitionCapaActionAction({ actionId: "c1", expectedVersion: 3, toStatus: "closed" })
    expect(result.ok).toBe(false)
    expect(mockTransition).not.toHaveBeenCalled()
  })
})

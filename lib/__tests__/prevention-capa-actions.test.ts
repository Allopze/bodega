import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const mockAuth = vi.hoisted(() => vi.fn())
const mockTransition = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
// Mockea solo las funciones de servicio; deja pasar capaTransitionSchema y
// CAPA_STATUSES reales para que el boundary parseZ de la action se valide
// contra el schema de producción real, no un doble de prueba.
vi.mock("@/lib/services/prevention-capa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/prevention-capa")>()
  return {
    ...actual,
    transitionCapaAction: mockTransition,
    addCapaEvidence: vi.fn(),
    addCapaFollowup: vi.fn(),
    updateCapaAction: vi.fn(),
    reconcileCapaAction: vi.fn(),
  }
})

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

  it("rejects invalid input via the parseZ boundary before calling the service", async () => {
    // Permiso válido para "verified", pero actionId vacío viola
    // capaTransitionSchema (min 1) — debe rechazarse antes de invocar
    // transitionCapaAction.
    mockAuth.mockResolvedValue(session(["prevention:capa:verify"]))
    const { transitionCapaActionAction } = await import("@/app/(app)/prevencion/capa/actions")
    const result = await transitionCapaActionAction({
      actionId: "", expectedVersion: 2, toStatus: "verified",
      effectivenessStatus: "effective", effectivenessAssessment: "Control observado en terreno",
    })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.actionId).toBeDefined()
    expect(mockTransition).not.toHaveBeenCalled()
  })
})

describe("capaTransitionSchema", () => {
  it("accepts a minimal valid transition payload", async () => {
    const { capaTransitionSchema } = await import("@/lib/services/prevention-capa")
    const result = capaTransitionSchema.safeParse({ actionId: "c1", expectedVersion: 1, toStatus: "in_progress" })
    expect(result.success).toBe(true)
  })

  it("rejects an unknown toStatus value", async () => {
    const { capaTransitionSchema } = await import("@/lib/services/prevention-capa")
    const result = capaTransitionSchema.safeParse({ actionId: "c1", expectedVersion: 1, toStatus: "not_a_status" })
    expect(result.success).toBe(false)
  })
})

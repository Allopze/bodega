/**
 * Fase 1 H-27 paso 4a: createEppRequirementAction y
 * escalateBlockingEppGapsAction migrados a parseZ.
 * Cubre el boundary de validación (input inválido rechazado sin invocar
 * el servicio) y que el camino exitoso sigue funcionando igual que antes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockCreateEppRequirement = vi.hoisted(() => vi.fn())
const mockEscalateBlockingEppGapsToCapa = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockResolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
// Mockea solo las funciones de servicio; deja pasar requirementSchema y
// escalateBlockingEppGapsSchema reales para que el boundary parseZ de la
// action valide contra el schema de producción, no un doble de prueba.
vi.mock("@/lib/services/prevention-epp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/prevention-epp")>()
  return {
    ...actual,
    createEppRequirement: mockCreateEppRequirement,
    escalateBlockingEppGapsToCapa: mockEscalateBlockingEppGapsToCapa,
  }
})

const session = {
  user: { id: "user-1", permissions: ["prevention:epp:manage"] },
}

describe("createEppRequirementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session, error: null })
    mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
    mockCreateEppRequirement.mockResolvedValue({ id: "req-1" })
  })

  it("forwards validated input to the service on success", async () => {
    const { createEppRequirementAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")
    const input = { eppTypeId: "epp-1", scopeType: "global", reason: "Exigido por el reglamento interno de higiene y seguridad." }

    const res = await createEppRequirementAction(input)

    expect(res.ok).toBe(true)
    expect(mockCreateEppRequirement).toHaveBeenCalledTimes(1)
    const [calledInput] = mockCreateEppRequirement.mock.calls[0]!
    expect(calledInput).toMatchObject({ eppTypeId: "epp-1", scopeType: "global", enforcement: "warning" })
  })

  it("rejects invalid input via the parseZ boundary before calling the service", async () => {
    const { createEppRequirementAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")

    // reason de 5 caracteres viola requirementSchema (min 10).
    const res = await createEppRequirementAction({ eppTypeId: "epp-1", scopeType: "global", reason: "corto" })

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.reason).toBeDefined()
    expect(mockCreateEppRequirement).not.toHaveBeenCalled()
  })

  it("rejects a worksite-scoped requirement missing worksiteId (superRefine)", async () => {
    const { createEppRequirementAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")

    const res = await createEppRequirementAction({
      eppTypeId: "epp-1", scopeType: "worksite", reason: "Exigido por procedimiento interno de faena.",
    })

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.worksiteId).toBeDefined()
    expect(mockCreateEppRequirement).not.toHaveBeenCalled()
  })

  it("rejects when the permission guard fails, without reaching parseZ or the service", async () => {
    mockGuardPermission.mockResolvedValue({
      session: null,
      error: { ok: false, message: "No tienes permisos para realizar esta acción" },
    })
    const { createEppRequirementAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")

    const res = await createEppRequirementAction({ eppTypeId: "epp-1", scopeType: "global", reason: "Fundamento con más de diez caracteres." })

    expect(res.ok).toBe(false)
    expect(mockCreateEppRequirement).not.toHaveBeenCalled()
  })
})

describe("escalateBlockingEppGapsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session, error: null })
    mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
    mockEscalateBlockingEppGapsToCapa.mockResolvedValue({ created: 1, skipped: 0 })
  })

  it("forwards a validated targetDate to the service on success", async () => {
    const { escalateBlockingEppGapsAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")

    const res = await escalateBlockingEppGapsAction({ targetDate: "2026-08-19" })

    expect(res.ok).toBe(true)
    expect(mockEscalateBlockingEppGapsToCapa).toHaveBeenCalledTimes(1)
    const [, calledArgs] = mockEscalateBlockingEppGapsToCapa.mock.calls[0]!
    expect(calledArgs).toEqual({ targetDate: "2026-08-19" })
  })

  it("rejects a targetDate that isn't YYYY-MM-DD via the parseZ boundary", async () => {
    const { escalateBlockingEppGapsAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")

    // Antes de esta migración, este objeto llegaba sin ningún chequeo
    // runtime — el tipo `{ targetDate: string }` sólo existía en TS.
    const res = await escalateBlockingEppGapsAction({ targetDate: "19-08-2026" })

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.targetDate).toBeDefined()
    expect(mockEscalateBlockingEppGapsToCapa).not.toHaveBeenCalled()
  })

  it("rejects when the permission guard fails, without reaching parseZ or the service", async () => {
    mockGuardPermission.mockResolvedValue({
      session: null,
      error: { ok: false, message: "No tienes permisos para realizar esta acción" },
    })
    const { escalateBlockingEppGapsAction } = await import("@/app/(app)/prevencion/epp-preventivo/actions")

    const res = await escalateBlockingEppGapsAction({ targetDate: "2026-08-19" })

    expect(res.ok).toBe(false)
    expect(mockEscalateBlockingEppGapsToCapa).not.toHaveBeenCalled()
  })
})

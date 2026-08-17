/**
 * Fase 1 H-27 paso 3: createEmergencyPlanAction migrado a parseZ.
 * Cubre el boundary de validación (input inválido rechazado sin invocar
 * el servicio) y que el camino exitoso sigue funcionando igual que antes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockCreateEmergencyPlan = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockResolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
// Mockea solo createEmergencyPlan; deja pasar planSchema real para que el
// boundary parseZ de la action valide contra el schema de producción, no
// un doble de prueba que podría divergir.
vi.mock("@/lib/services/prevention-emergency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/prevention-emergency")>()
  return { ...actual, createEmergencyPlan: mockCreateEmergencyPlan }
})

const session = {
  user: { id: "user-1", permissions: ["prevention:emergency:manage"] },
}

describe("createEmergencyPlanAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session, error: null })
    mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
    mockCreateEmergencyPlan.mockResolvedValue({ id: "plan-1" })
  })

  it("forwards validated input to the service on success", async () => {
    const { createEmergencyPlanAction } = await import("@/app/(app)/prevencion/emergencias/actions")
    const input = { worksiteId: "ws-1", title: "Plan de emergencia faena norte" }

    const res = await createEmergencyPlanAction(input)

    expect(res.ok).toBe(true)
    expect(mockCreateEmergencyPlan).toHaveBeenCalledTimes(1)
    const [calledInput] = mockCreateEmergencyPlan.mock.calls[0]!
    expect(calledInput).toMatchObject({ worksiteId: "ws-1", title: "Plan de emergencia faena norte" })
  })

  it("rejects invalid input via the parseZ boundary before calling the service", async () => {
    const { createEmergencyPlanAction } = await import("@/app/(app)/prevencion/emergencias/actions")

    // title de 2 caracteres viola planSchema (min 3). Antes de esta
    // migración, esto llegaba al catch de run() y devolvía el mensaje
    // crudo de ZodError sin fieldErrors.
    const res = await createEmergencyPlanAction({ worksiteId: "ws-1", title: "ab" })

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.title).toBeDefined()
    expect(mockCreateEmergencyPlan).not.toHaveBeenCalled()
  })

  // Fase 7 punto 3: `EmergencyDomainError` prometía en su JSDoc que la capa de
  // acciones la distinguiría de un fallo inesperado, pero `run()` devolvía el
  // `message` de cualquier Error. Estas dos pruebas fijan las dos mitades del
  // contrato para que no vuelva a quedar en prosa.
  it("passes a domain error message through to the user", async () => {
    const { EmergencyDomainError } = await import("@/lib/services/prevention-emergency")
    mockCreateEmergencyPlan.mockRejectedValue(new EmergencyDomainError("La faena ya tiene el plan PE-2026-ABC vigente."))
    const { createEmergencyPlanAction } = await import("@/app/(app)/prevencion/emergencias/actions")

    const res = await createEmergencyPlanAction({ worksiteId: "ws-1", title: "Plan válido de emergencia" })

    expect(res).toMatchObject({ ok: false, message: "La faena ya tiene el plan PE-2026-ABC vigente." })
  })

  it("hides an unexpected error behind the generic message", async () => {
    // Un error de driver trae texto de infraestructura (tabla, columna,
    // constraint): eso no puede llegar al navegador.
    mockCreateEmergencyPlan.mockRejectedValue(new Error('duplicate key value violates unique constraint "prevention_emergency_plans_pkey"'))
    const { createEmergencyPlanAction } = await import("@/app/(app)/prevencion/emergencias/actions")

    const res = await createEmergencyPlanAction({ worksiteId: "ws-1", title: "Plan válido de emergencia" })

    expect(res.ok).toBe(false)
    expect(res.message).toBe("No se pudo completar la acción. Intenta nuevamente.")
    expect(res.message).not.toContain("constraint")
  })

  it("rejects when the permission guard fails, without reaching parseZ or the service", async () => {
    mockGuardPermission.mockResolvedValue({
      session: null,
      error: { ok: false, message: "No tienes permisos para realizar esta acción" },
    })
    const { createEmergencyPlanAction } = await import("@/app/(app)/prevencion/emergencias/actions")

    const res = await createEmergencyPlanAction({ worksiteId: "ws-1", title: "Plan válido" })

    expect(res.ok).toBe(false)
    expect(mockCreateEmergencyPlan).not.toHaveBeenCalled()
  })
})

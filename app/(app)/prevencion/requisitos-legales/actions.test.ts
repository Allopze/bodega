import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const assessLegalCompliance = vi.hoisted(() => vi.fn())
const approveLegalApplicability = vi.hoisted(() => vi.fn())
const transitionLegalRequirement = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-risk-legal", () => ({
  approveLegalApplicability,
  assessLegalCompliance,
  createLegalRequirementDraft: vi.fn(),
  proposeLegalApplicability: vi.fn(),
  transitionLegalRequirement,
}))

import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import {
  approveLegalApplicabilityAction,
  assessLegalComplianceAction,
  transitionLegalRequirementAction,
} from "./actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos" } }
const session = {
  user: {
    id: "trusted-legal-user",
    permissions: ["prevention:legal:assess", "prevention:legal:approve_applicability"],
  },
}

describe("legal register server actions are authorization boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
  })

  it("uses the authenticated identity and exact faena scope for assessments", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    assessLegalCompliance.mockResolvedValue({})
    const forged = { applicabilityId: "app-1", userId: "forged", scope: { mode: "all", ids: [] } }

    await expect(assessLegalComplianceAction(forged)).resolves.toEqual({ ok: true })

    expect(guardPermission).toHaveBeenCalledWith("prevention:legal:assess")
    expect(assessLegalCompliance).toHaveBeenCalledWith(forged, {
      userId: "trusted-legal-user",
      scope: { mode: "some", ids: ["ws-own"] },
      permissions: session.user.permissions,
    })
  })

  it("blocks applicability approval without the segregated permission", async () => {
    guardPermission.mockResolvedValue(denied)

    await approveLegalApplicabilityAction({ applicabilityId: "app-1" })

    expect(guardPermission).toHaveBeenCalledWith("prevention:legal:approve_applicability")
    expect(approveLegalApplicability).not.toHaveBeenCalled()
  })

  it.each(["approved", "published"])("requires approval permission to transition a requirement to %s", async (toStatus) => {
    guardPermission.mockResolvedValue(denied)

    await transitionLegalRequirementAction({ requirementId: "req-1", toStatus })

    expect(guardPermission).toHaveBeenCalledWith("prevention:legal:approve_applicability")
    expect(transitionLegalRequirement).not.toHaveBeenCalled()
  })
})

/*
 * Todo error del servicio caía en «No se pudo completar la acción»: quien
 * aprobaba su propia aplicabilidad o evaluaba sin evidencia no sabía por qué
 * se rechazaba. El error de dominio viaja con su mensaje; el resto sigue
 * oculto tras el genérico.
 */
describe("requisitos legales: los rechazos de negocio llegan con su motivo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
    guardPermission.mockResolvedValue({ session, error: null })
  })

  it("evaluar, aprobar la aplicabilidad y cambiar de estado devuelven el motivo", async () => {
    assessLegalCompliance.mockRejectedValue(new RiskLegalDomainError("La evaluación exige evidencia verificable."))
    approveLegalApplicability.mockRejectedValue(new RiskLegalDomainError("Quien propuso la aplicabilidad no puede aprobarla."))
    transitionLegalRequirement.mockRejectedValue(new RiskLegalDomainError("El requisito cambió; recarga antes de continuar."))

    await expect(assessLegalComplianceAction({ requirementId: "req-1" }))
      .resolves.toEqual({ ok: false, message: "La evaluación exige evidencia verificable." })
    await expect(approveLegalApplicabilityAction({ applicabilityId: "app-1" }))
      .resolves.toEqual({ ok: false, message: "Quien propuso la aplicabilidad no puede aprobarla." })
    await expect(transitionLegalRequirementAction({ requirementId: "req-1", toStatus: "active" }))
      .resolves.toEqual({ ok: false, message: "El requisito cambió; recarga antes de continuar." })
  })

  it("un error inesperado sigue oculto tras el mensaje genérico", async () => {
    assessLegalCompliance.mockRejectedValue(new Error('duplicate key value violates unique constraint "prevention_legal_assessments_pkey"'))
    await expect(assessLegalComplianceAction({ requirementId: "req-1" }))
      .resolves.toEqual({ ok: false, message: "No se pudo completar la acción. Intenta nuevamente." })
  })
})

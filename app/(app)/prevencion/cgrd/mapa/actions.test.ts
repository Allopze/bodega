import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const addRiskMapMarker = vi.hoisted(() => vi.fn())
const removeRiskMapMarker = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-own"] }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-risk-map", () => ({ addRiskMapMarker, removeRiskMapMarker }))

import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { addRiskMapMarkerAction, removeRiskMapMarkerAction } from "./actions"

const session = { user: { id: "trusted-map-user", permissions: ["prevention:risk:edit"] } }

/*
 * Todo error del servicio caía en «No se pudo completar la acción»: marcar un
 * peligro sobre una matriz que no está publicada, o fuera del plano, se leía
 * como una falla sin causa. El error de dominio viaja con su mensaje; el resto
 * sigue oculto tras el genérico.
 */
describe("mapa de riesgos: los rechazos de negocio llegan con su motivo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardPermission.mockResolvedValue({ session, error: null })
  })

  it("agregar y quitar un marcador devuelven el motivo del servicio", async () => {
    addRiskMapMarker.mockRejectedValue(new RiskLegalDomainError("El peligro no pertenece a la MIPER publicada de la faena."))
    removeRiskMapMarker.mockRejectedValue(new RiskLegalDomainError("Marcador no encontrado o fuera de alcance."))

    await expect(addRiskMapMarkerAction({ markerId: "m-1" }))
      .resolves.toEqual({ ok: false, message: "El peligro no pertenece a la MIPER publicada de la faena." })
    await expect(removeRiskMapMarkerAction({ markerId: "m-1" }))
      .resolves.toEqual({ ok: false, message: "Marcador no encontrado o fuera de alcance." })
  })

  it("un error inesperado sigue oculto tras el mensaje genérico", async () => {
    addRiskMapMarker.mockRejectedValue(new Error('duplicate key value violates unique constraint "prevention_risk_map_markers_pkey"'))
    await expect(addRiskMapMarkerAction({ markerId: "m-1" }))
      .resolves.toEqual({ ok: false, message: "No se pudo completar la acción. Intenta nuevamente." })
  })
})

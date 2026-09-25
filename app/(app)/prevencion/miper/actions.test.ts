import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const createRiskMatrixDraft = vi.hoisted(() => vi.fn())
const transitionRiskMatrix = vi.hoisted(() => vi.fn())
const approveRiskImportBatch = vi.hoisted(() => vi.fn())
const stageRiskImport = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/services/prevention-risk-legal", () => ({
  addRiskEntry: vi.fn(),
  createRiskMatrixDraft,
  createRiskMethodology: vi.fn(),
  createRiskReviewTrigger: vi.fn(),
  ensureIspRiskMethodology: vi.fn(),
  resolveRiskReviewTrigger: vi.fn(),
  transitionRiskMatrix,
}))
vi.mock("@/lib/services/prevention-risk-import", () => ({
  activateRiskImportBatch: vi.fn(),
  approveRiskImportBatch,
  resolveRiskImportRow: vi.fn(),
  stageRiskImport,
  RISK_IMPORT_MAX_BYTES: 10 * 1024 * 1024,
}))

import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import {
  approveRiskImportBatchAction,
  createRiskMatrixDraftAction,
  stageRiskImportAction,
  transitionRiskMatrixAction,
} from "./actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos" } }
const session = {
  user: {
    id: "trusted-risk-user",
    permissions: ["prevention:risk:edit", "prevention:risk:review", "prevention:risk:approve", "prevention:risk:publish"],
  },
}

describe("MIPER server actions are authorization boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
  })

  it("blocks writes before invoking the domain service", async () => {
    guardPermission.mockResolvedValue(denied)

    await expect(createRiskMatrixDraftAction({ worksiteId: "ws-foreign" })).resolves.toEqual(denied.error)

    expect(guardPermission).toHaveBeenCalledWith("prevention:risk:edit")
    expect(createRiskMatrixDraft).not.toHaveBeenCalled()
  })

  it("derives actor, scope and permissions from the authenticated session", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    createRiskMatrixDraft.mockResolvedValue({})
    const forged = { worksiteId: "ws-own", userId: "forged-user", permissions: ["*"] }

    await expect(createRiskMatrixDraftAction(forged)).resolves.toEqual({ ok: true })

    expect(createRiskMatrixDraft).toHaveBeenCalledWith(forged, {
      userId: "trusted-risk-user",
      scope: { mode: "some", ids: ["ws-own"] },
      permissions: session.user.permissions,
    })
  })

  it.each([
    ["reviewed", "prevention:risk:review"],
    ["approved", "prevention:risk:approve"],
    ["published", "prevention:risk:publish"],
  ])("requires the specific %s workflow permission", async (toStatus, permission) => {
    guardPermission.mockResolvedValue(denied)

    await transitionRiskMatrixAction({ matrixId: "matrix-1", toStatus })

    expect(guardPermission).toHaveBeenCalledWith(permission)
    expect(transitionRiskMatrix).not.toHaveBeenCalled()
  })

  it("requires approval permission for an import batch", async () => {
    guardPermission.mockResolvedValue(denied)

    await approveRiskImportBatchAction("batch-1")

    expect(guardPermission).toHaveBeenCalledWith("prevention:risk:approve")
    expect(approveRiskImportBatch).not.toHaveBeenCalled()
  })
})

/*
 * Todo error del servicio caía en «No se pudo completar la acción»: quien
 * intentaba publicar lo que él mismo aprobó, o avanzar una matriz que otra
 * persona acababa de cambiar, no se enteraba del motivo. El error de dominio
 * viaja con su mensaje; el resto sigue oculto tras el genérico.
 */
describe("MIPER: los rechazos de negocio llegan con su motivo", () => {
  const GENERIC = "No se pudo completar la acción. Intenta nuevamente."

  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
    guardPermission.mockResolvedValue({ session, error: null })
  })

  it("una transición rechazada devuelve el motivo del servicio", async () => {
    transitionRiskMatrix.mockRejectedValue(new RiskLegalDomainError("Publicar exige una firma distinta de quien aprobó."))
    await expect(transitionRiskMatrixAction({ matrixId: "matrix-1", toStatus: "published" }))
      .resolves.toEqual({ ok: false, message: "Publicar exige una firma distinta de quien aprobó." })
  })

  it("crear, aprobar un lote e importar también", async () => {
    createRiskMatrixDraft.mockRejectedValue(new RiskLegalDomainError("La faena ya tiene una MIPER en borrador."))
    approveRiskImportBatch.mockRejectedValue(new RiskLegalDomainError("El lote tiene filas sin resolver."))
    stageRiskImport.mockRejectedValue(new RiskLegalDomainError("La planilla no trae la hoja de peligros."))
    const formData = new FormData()
    formData.set("worksiteId", "ws-own")
    formData.set("file", new File(["x"], "miper.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))

    await expect(createRiskMatrixDraftAction({ worksiteId: "ws-own" })).resolves.toEqual({ ok: false, message: "La faena ya tiene una MIPER en borrador." })
    await expect(approveRiskImportBatchAction("batch-1")).resolves.toEqual({ ok: false, message: "El lote tiene filas sin resolver." })
    await expect(stageRiskImportAction(formData)).resolves.toEqual({ ok: false, message: "La planilla no trae la hoja de peligros." })
  })

  it("un error inesperado sigue oculto tras el mensaje genérico", async () => {
    transitionRiskMatrix.mockRejectedValue(new Error('duplicate key value violates unique constraint "prevention_risk_matrices_pkey"'))
    await expect(transitionRiskMatrixAction({ matrixId: "matrix-1", toStatus: "published" }))
      .resolves.toEqual({ ok: false, message: GENERIC })
  })
})

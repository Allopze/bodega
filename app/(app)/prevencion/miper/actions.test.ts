import { beforeEach, describe, expect, it, vi } from "vitest"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const createMiper = vi.hoisted(() => vi.fn())
const saveMiperEntry = vi.hoisted(() => vi.fn())
const submitMiperForReview = vi.hoisted(() => vi.fn())
const approveMiperTechnicalReview = vi.hoisted(() => vi.fn())
const approveMiperFinal = vi.hoisted(() => vi.fn())
const listMiperWorksiteTargets = vi.hoisted(() => vi.fn())
const commitRiskImport = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/lib/services/generated-documents/schedule", () => ({ scheduleGeneratedDocumentDrain: vi.fn() }))
vi.mock("@/lib/services/prevention-risk-legal", () => ({ resolveRiskReviewTrigger: vi.fn(), verifyRiskControl: vi.fn() }))
vi.mock("@/lib/services/miper/matrices", () => ({ createMiper, updateMiperHeader: vi.fn(), discardMiperDraft: vi.fn() }))
vi.mock("@/lib/services/miper/entries", () => ({ saveMiperEntry, duplicateMiperEntry: vi.fn(), deleteMiperEntry: vi.fn(), saveMiperControl: vi.fn(), deleteMiperControl: vi.fn() }))
vi.mock("@/lib/services/miper/observations", () => ({ addMiperObservation: vi.fn(), respondMiperObservation: vi.fn(), resolveMiperObservation: vi.fn(), reopenMiperObservation: vi.fn() }))
vi.mock("@/lib/services/miper/workflow", () => ({ submitMiperForReview, openMiperReviewRound: vi.fn(), returnMiperWithObservations: vi.fn(), approveMiperTechnicalReview, requestMiperCorrections: vi.fn(), approveMiperFinal }))
vi.mock("@/lib/services/miper/risk-factors", () => ({ saveRiskFactor: vi.fn(), setRiskFactorActive: vi.fn() }))
vi.mock("@/lib/services/miper/portfolio", () => ({ listMiperWorksiteTargets }))
vi.mock("@/lib/services/miper/import", () => ({ previewRiskImport: vi.fn(), commitRiskImport }))

import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { approveMiperFinalAction, approveMiperTechnicalAction, commitRiskImportAction, createMiperAction, listMiperWorksiteTargetsAction, saveMiperEntryAction, submitMiperAction } from "./actions"

const denied = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
const session = { user: { id: "trusted-user", permissions: ["prevention:risk:edit"] } }

describe("acciones MIPER: frontera de autorización", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveWorksiteScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
  })

  it("bloquea antes de llamar al servicio", async () => {
    guardPermission.mockResolvedValue(denied)
    await expect(createMiperAction({ worksiteId: "ws-foreign" })).resolves.toEqual(denied.error)
    expect(guardPermission).toHaveBeenCalledWith("prevention:risk:edit")
    expect(createMiper).not.toHaveBeenCalled()
  })

  it.each([
    [submitMiperAction, "prevention:risk:edit"],
    [approveMiperTechnicalAction, "prevention:risk:review"],
    [approveMiperFinalAction, "prevention:risk:approve_legal"],
  ])("cada paso del flujo exige su propio permiso", async (action, permission) => {
    guardPermission.mockResolvedValue(denied)
    await action({ matrixId: "m1", expectedVersion: 1 })
    expect(guardPermission).toHaveBeenCalledWith(permission)
  })

  it("el actor, alcance y permisos salen de la sesión, no del input", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    createMiper.mockResolvedValue({ id: "m-new" })
    const state = await createMiperAction({ worksiteId: "ws-own", period: 2026, revisionReason: "x".repeat(12), userId: "spoofed" })
    expect(state).toEqual({ ok: true, data: { id: "m-new" }, message: "MIPER creada" })
    expect(createMiper).toHaveBeenCalledWith(expect.anything(), { userId: "trusted-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:risk:edit"] })
  })

  it("cada paso del flujo anuncia lo que hizo, no un mensaje genérico", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    submitMiperForReview.mockResolvedValue({ roundId: "r1" })
    approveMiperTechnicalReview.mockResolvedValue(undefined)
    approveMiperFinal.mockResolvedValue({ versionId: "v1", versionNumber: 1 })
    await expect(submitMiperAction({ matrixId: "m1", expectedVersion: 1 })).resolves.toEqual({ ok: true, message: "MIPER enviada a revisión" })
    await expect(approveMiperTechnicalAction({ matrixId: "m1", expectedVersion: 2 })).resolves.toEqual({ ok: true, message: "Revisión técnica aprobada" })
    await expect(approveMiperFinalAction({ matrixId: "m1", expectedVersion: 3, changeSummary: "Emisión inicial del documento." })).resolves.toEqual({ ok: true, data: { versionId: "v1", versionNumber: 1 }, message: "Versión sellada" })
  })

  it("guardar una fila devuelve la versión nueva y no revalida la página", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    saveMiperEntry.mockResolvedValue({ id: "e1", version: 3, rowNumber: 1, magnitude: 8, classification: "important" })
    await expect(saveMiperEntryAction({ matrixId: "m1", entryId: "e1", expectedVersion: 2, values: { probability: 2 } })).resolves.toEqual({ ok: true, data: { id: "e1", version: 3, rowNumber: 1, magnitude: 8, classification: "important" } })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("crear un riesgo (sin entryId) sí revalida: sin eso, «atrás» restaura la página de antes de crearlo", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    saveMiperEntry.mockResolvedValue({ id: "e-new", version: 1, rowNumber: 5, magnitude: null, classification: null })
    await expect(saveMiperEntryAction({ matrixId: "m1", insertAfterRowNumber: 4, values: { activity: "A", task: "T" } })).resolves.toEqual({ ok: true, data: { id: "e-new", version: 1, rowNumber: 5, magnitude: null, classification: null } })
    expect(revalidatePath).toHaveBeenCalledWith("/prevencion/miper/m1")
  })

  it("un guardado rechazado no revalida, ni al crear", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    saveMiperEntry.mockRejectedValueOnce(new RiskLegalDomainError("La MIPER no se puede editar."))
    await expect(saveMiperEntryAction({ matrixId: "m1", values: { activity: "A" } })).resolves.toEqual({ ok: false, message: "La MIPER no se puede editar." })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("los rechazos de dominio llegan con su motivo; lo inesperado queda genérico", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    submitMiperForReview.mockRejectedValueOnce(new RiskLegalDomainError("Responde todas las observaciones antes de reenviar (2 sin responder)."))
    await expect(submitMiperAction({ matrixId: "m1", expectedVersion: 4 })).resolves.toEqual({ ok: false, message: "Responde todas las observaciones antes de reenviar (2 sin responder)." })
    submitMiperForReview.mockRejectedValueOnce(new Error("relation does not exist"))
    const state = await submitMiperAction({ matrixId: "m1", expectedVersion: 4 })
    expect(state.ok).toBe(false)
    expect(state.message).not.toMatch(/relation/)
  })

  it("la lista del selector de faena exige ver MIPER, sale del alcance de la sesión y no revalida", async () => {
    guardPermission.mockResolvedValue(denied)
    await expect(listMiperWorksiteTargetsAction({})).resolves.toEqual(denied.error)
    expect(guardPermission).toHaveBeenCalledWith("prevention:risk:view")
    expect(listMiperWorksiteTargets).not.toHaveBeenCalled()

    const targets = [{ worksiteId: "ws-own", worksiteName: "Faena propia", matrixId: "m1", period: 2026 }]
    guardPermission.mockResolvedValue({ session, error: null })
    listMiperWorksiteTargets.mockResolvedValue(targets)
    await expect(listMiperWorksiteTargetsAction({ userId: "spoofed" })).resolves.toEqual({ ok: true, data: { targets } })
    expect(listMiperWorksiteTargets).toHaveBeenCalledWith({ userId: "trusted-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:risk:edit"] })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("la carga del RE-04 dice cuántos riesgos y medidas creó, y que las medidas quedan propuestas (Fase C)", async () => {
    guardPermission.mockResolvedValue({ session, error: null })
    commitRiskImport.mockResolvedValue({ batchId: "b1", matrixId: "m-imp", target: "draft", created: 3, skipped: 1, notified: 0, measures: { total: 10, existing: 6, pending: 4 } })
    await expect(commitRiskImportAction({ batchId: "b1" })).resolves.toEqual({
      ok: true,
      message: "3 riesgos cargados con 10 medidas propuestas (6 existentes y 4 por implementar); 1 fila detenida",
      data: { matrixId: "m-imp", created: 3, skipped: 1, measures: { total: 10, existing: 6, pending: 4 } },
    })
    commitRiskImport.mockResolvedValue({ batchId: "b2", matrixId: "m-imp", target: "live", created: 1, skipped: 0, notified: 0, measures: { total: 0, existing: 0, pending: 0 } })
    await expect(commitRiskImportAction({ batchId: "b2" })).resolves.toMatchObject({ ok: true, message: "1 riesgo cargado" })
  })
})

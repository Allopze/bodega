import { describe, expect, it } from "vitest"
import { resolveWorkspaceMode } from "./workspace-mode"

const base = { status: "draft", reviewState: "none", isLegacy: false, openRoundStage: null, submittedByUserId: null, userId: "u1", permissions: ["prevention:risk:view", "prevention:risk:edit"], inScope: true } as const

describe("modo del espacio de trabajo", () => {
  it("la prevencionista edita su borrador; no observa ni aprueba", () => {
    expect(resolveWorkspaceMode(base)).toMatchObject({ canEdit: true, canObserve: false, canReviewTechnical: false, canApproveLegal: false, readOnlyReason: null })
  })
  it("en revisión técnica la Jefa observa y decide, salvo que ella haya enviado", () => {
    const jefa = { ...base, reviewState: "in_review", openRoundStage: "technical" as const, submittedByUserId: "u9", permissions: ["prevention:risk:view", "prevention:risk:review"] }
    expect(resolveWorkspaceMode(jefa)).toMatchObject({ canReviewTechnical: true, canObserve: true, canEdit: false })
    expect(resolveWorkspaceMode({ ...jefa, submittedByUserId: "u1" })).toMatchObject({ canReviewTechnical: false, canObserve: false, isSubmitter: true })
  })
  it("pendiente de aprobación: Legal y RRHH decide; la prevencionista puede seguir editando (irá a la ronda siguiente)", () => {
    const pending = { ...base, reviewState: "pending_approval", openRoundStage: "legal_rrhh" as const, submittedByUserId: "u9" }
    expect(resolveWorkspaceMode({ ...pending, permissions: ["prevention:risk:view", "prevention:risk:approve_legal"] })).toMatchObject({ canApproveLegal: true, canObserve: true })
    expect(resolveWorkspaceMode(pending)).toMatchObject({ canEdit: true, canApproveLegal: false })
  })
  it("con observaciones la prevencionista responde", () => {
    expect(resolveWorkspaceMode({ ...base, reviewState: "observed" })).toMatchObject({ canEdit: true, canRespond: true })
  })
  it("legacy, reemplazada o fuera de faena: sólo lectura, con el motivo", () => {
    expect(resolveWorkspaceMode({ ...base, isLegacy: true }).readOnlyReason).toMatch(/metodología anterior/)
    expect(resolveWorkspaceMode({ ...base, status: "superseded" }).readOnlyReason).toMatch(/reemplazada/)
    expect(resolveWorkspaceMode({ ...base, inScope: false }).canEdit).toBe(false)
  })
})

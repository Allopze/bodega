import { describe, expect, it } from "vitest"
import { canExecuteProgramAction, resolveWorkspaceMode } from "./workspace-mode"

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

describe("ejecución del Programa de Trabajo (§6.3)", () => {
  const execute = { ...base, permissions: ["prevention:risk:view", "prevention:risk:program:execute"] }

  it("con el permiso de ejecución registra ocurrencias y evidencia", () => {
    expect(resolveWorkspaceMode(execute).canExecuteProgram).toBe(true)
  })
  it("editar el MIPER no basta para ejecutar el programa", () => {
    expect(resolveWorkspaceMode(base).canExecuteProgram).toBe(false)
  })
  it("el responsable de la actividad registra con sólo ver la faena", () => {
    const responsable = { ...base, isProgramResponsible: true }
    expect(resolveWorkspaceMode(responsable).canExecuteProgram).toBe(true)
    expect(resolveWorkspaceMode({ ...responsable, inScope: false }).canExecuteProgram).toBe(false)
  })
  it("legacy o reemplazada: no se ejecuta, el programa de un período cerrado es historia", () => {
    expect(resolveWorkspaceMode({ ...execute, isLegacy: true }).canExecuteProgram).toBe(false)
    expect(resolveWorkspaceMode({ ...execute, status: "superseded" }).canExecuteProgram).toBe(false)
  })
  it("por actividad, la ejecución también es de quien la tiene asignada", () => {
    const soloVe = resolveWorkspaceMode(base)
    const conPermiso = resolveWorkspaceMode(execute)
    const mine = { userId: "u1", responsibleUserId: "u1" }
    expect(canExecuteProgramAction(soloVe, mine)).toBe(true)
    expect(canExecuteProgramAction(soloVe, { userId: "u1", responsibleUserId: "u9" })).toBe(false)
    expect(canExecuteProgramAction(soloVe, { userId: "u1", responsibleUserId: null })).toBe(false)
    // Con el permiso, la actividad ajena también se registra.
    expect(canExecuteProgramAction(conPermiso, { userId: "u1", responsibleUserId: "u9" })).toBe(true)
    // Y en un MIPER cerrado no se registra nada, ni la propia.
    expect(canExecuteProgramAction(resolveWorkspaceMode({ ...execute, status: "superseded" }), mine)).toBe(false)
    expect(canExecuteProgramAction(resolveWorkspaceMode({ ...base, isLegacy: true }), mine)).toBe(false)
  })
})

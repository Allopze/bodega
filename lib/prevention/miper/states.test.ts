import { describe, expect, it } from "vitest"
import { MIPER_ACTION_RULES, miperStatusLabel, pendingSignaturePermission } from "./states"

describe("estados del MIPER", () => {
  it("las reglas de transición son las del §6.2 del spec", () => {
    expect(MIPER_ACTION_RULES.submit).toMatchObject({ from: ["none", "observed"], to: "in_review", permission: "prevention:risk:edit" })
    expect(MIPER_ACTION_RULES.return).toMatchObject({ from: ["in_review"], to: "observed", permission: "prevention:risk:review" })
    expect(MIPER_ACTION_RULES.approve_technical).toMatchObject({ from: ["in_review"], to: "pending_approval", permission: "prevention:risk:review" })
    expect(MIPER_ACTION_RULES.request_corrections).toMatchObject({ from: ["pending_approval"], to: "observed", permission: "prevention:risk:approve_legal" })
    expect(MIPER_ACTION_RULES.approve_final).toMatchObject({ from: ["pending_approval"], to: "none", permission: "prevention:risk:approve_legal" })
  })
  it("rótulo combinado sin estados ambiguos", () => {
    const base = { versionNumber: null, hasUnsentChanges: false, roundOpened: false }
    expect(miperStatusLabel({ ...base, status: "draft", reviewState: "none" })).toBe("Borrador")
    expect(miperStatusLabel({ ...base, status: "draft", reviewState: "in_review" })).toBe("Enviado a revisión")
    expect(miperStatusLabel({ ...base, status: "draft", reviewState: "in_review", roundOpened: true })).toBe("En revisión por Prevención")
    expect(miperStatusLabel({ ...base, status: "draft", reviewState: "pending_approval" })).toBe("Revisión técnica aprobada · Pendiente de aprobación Legal y RRHH")
    expect(miperStatusLabel({ ...base, status: "published", reviewState: "none", versionNumber: 3 })).toBe("Vigente · v3")
    expect(miperStatusLabel({ ...base, status: "published", reviewState: "none", versionNumber: 3, hasUnsentChanges: true })).toBe("Vigente v3 · cambios pendientes de revisión")
    expect(miperStatusLabel({ ...base, status: "published", reviewState: "observed", versionNumber: 3 })).toBe("Vigente v3 · con observaciones")
    expect(miperStatusLabel({ ...base, status: "superseded", reviewState: "none", versionNumber: 5 })).toBe("Reemplazado")
    expect(miperStatusLabel({ ...base, status: "published", reviewState: "none", isLegacy: true })).toBe("Vigente · metodología anterior")
  })
  it("firma pendiente: a quién avisar en cada estado", () => {
    expect(pendingSignaturePermission("in_review")).toBe("prevention:risk:review")
    expect(pendingSignaturePermission("pending_approval")).toBe("prevention:risk:approve_legal")
    expect(pendingSignaturePermission("observed")).toBeNull()
    expect(pendingSignaturePermission("none")).toBeNull()
  })
})

import { describe, expect, it } from "vitest"
import { miperInboxReason } from "./inbox"

const base = { status: "draft", reviewState: "none", isLegacy: false, hasUnsentChanges: false, submittedByUserId: null }
const editor = { userId: "u-prev", permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const jefa = { userId: "u-jefa", permissions: ["prevention:risk:view", "prevention:risk:review"] }
const legal = { userId: "u-legal", permissions: ["prevention:risk:view", "prevention:risk:approve_legal"] }
const lectora = { userId: "u-ver", permissions: ["prevention:risk:view"] }
const doble = { userId: "u-doble", permissions: ["prevention:risk:view", "prevention:risk:edit", "prevention:risk:review", "prevention:risk:approve_legal"] }

describe("miperInboxReason: qué espera una MIPER de una persona", () => {
  it("a quien edita: su borrador, las observaciones por responder y los cambios sin enviar", () => {
    expect(miperInboxReason(base, editor)).toBe("Borrador")
    expect(miperInboxReason({ ...base, reviewState: "observed" }, editor)).toBe("Con observaciones")
    expect(miperInboxReason({ ...base, status: "published", reviewState: "observed" }, editor)).toBe("Con observaciones")
    expect(miperInboxReason({ ...base, status: "published", hasUnsentChanges: true }, editor)).toBe("Cambios sin enviar")
    expect(miperInboxReason({ ...base, status: "published" }, editor)).toBeNull()
    expect(miperInboxReason({ ...base, reviewState: "in_review", submittedByUserId: "u-x" }, editor)).toBeNull()
  })

  it("la metodología anterior y las reemplazadas no piden nada", () => {
    expect(miperInboxReason({ ...base, isLegacy: true }, editor)).toBeNull()
    expect(miperInboxReason({ ...base, status: "superseded" }, doble)).toBeNull()
  })

  it("a la Jefa lo enviado a revisión; a Legal y RRHH lo que espera su firma; a quien sólo lee, nada", () => {
    expect(miperInboxReason({ ...base, reviewState: "in_review", submittedByUserId: "u-prev" }, jefa)).toBe("Pendiente de tu revisión")
    expect(miperInboxReason({ ...base, reviewState: "pending_approval", submittedByUserId: "u-prev" }, jefa)).toBeNull()
    expect(miperInboxReason({ ...base, reviewState: "pending_approval", submittedByUserId: "u-prev" }, legal)).toBe("Pendiente de tu firma")
    expect(miperInboxReason({ ...base, reviewState: "in_review", submittedByUserId: "u-prev" }, lectora)).toBeNull()
  })

  it("quien envió la ronda no la ve como pendiente de su revisión ni de su firma (como workspace-mode)", () => {
    expect(miperInboxReason({ ...base, reviewState: "in_review", submittedByUserId: "u-doble" }, doble)).toBeNull()
    expect(miperInboxReason({ ...base, reviewState: "pending_approval", submittedByUserId: "u-doble" }, doble)).toBeNull()
    expect(miperInboxReason({ ...base, reviewState: "in_review", submittedByUserId: "u-prev" }, doble)).toBe("Pendiente de tu revisión")
  })
})

import { describe, expect, it } from "vitest"
import { canTransitionGrdMatrix, grdMatrixTransitionPermission, grdStructureSatisfies, resolveGrdStructure } from "./cgrd"

describe("canTransitionGrdMatrix", () => {
  it("permite el avance normal de la máquina", () => {
    expect(canTransitionGrdMatrix("draft", "in_review")).toBe(true)
    expect(canTransitionGrdMatrix("in_review", "reviewed")).toBe(true)
    expect(canTransitionGrdMatrix("reviewed", "approved")).toBe(true)
    expect(canTransitionGrdMatrix("approved", "published")).toBe(true)
  })

  it("permite la devolución del revisor (MIPER-10), no saltos hacia adelante", () => {
    expect(canTransitionGrdMatrix("in_review", "draft")).toBe(true)
    expect(canTransitionGrdMatrix("draft", "approved")).toBe(false)
    expect(canTransitionGrdMatrix("draft", "published")).toBe(false)
  })

  it("published y superseded son terminales", () => {
    expect(canTransitionGrdMatrix("published", "superseded")).toBe(false)
    expect(canTransitionGrdMatrix("superseded", "draft")).toBe(false)
  })
})

describe("grdMatrixTransitionPermission", () => {
  it("la devolución a borrador pide permiso de revisión, no de edición", () => {
    expect(grdMatrixTransitionPermission("draft")).toBe("prevention:cgrd:matrix:review")
  })
  it("cada estado exige su propio permiso segregado", () => {
    expect(grdMatrixTransitionPermission("in_review")).toBe("prevention:cgrd:matrix:edit")
    expect(grdMatrixTransitionPermission("reviewed")).toBe("prevention:cgrd:matrix:review")
    expect(grdMatrixTransitionPermission("approved")).toBe("prevention:cgrd:matrix:approve")
    expect(grdMatrixTransitionPermission("published")).toBe("prevention:cgrd:matrix:publish")
  })
  it("un valor desconocido cae a edición, el permiso más restrictivo de entrada", () => {
    expect(grdMatrixTransitionPermission("")).toBe("prevention:cgrd:matrix:edit")
  })
})

describe("resolveGrdStructure — umbral del DS 44", () => {
  it("hasta 25 personas corresponde coordinador; desde 26, comité", () => {
    expect(resolveGrdStructure(1)).toBe("coordinator")
    expect(resolveGrdStructure(25)).toBe("coordinator")
    expect(resolveGrdStructure(26)).toBe("committee")
    expect(resolveGrdStructure(400)).toBe("committee")
  })

  it("una faena sin dotación cargada no exige comité", () => {
    expect(resolveGrdStructure(0)).toBe("coordinator")
  })
})

describe("grdStructureSatisfies — sobrecumplir no es incumplir", () => {
  it("el comité basta en cualquier dotación", () => {
    expect(grdStructureSatisfies("committee", 5)).toBe(true)
    expect(grdStructureSatisfies("committee", 500)).toBe(true)
  })

  it("el coordinador basta hasta 25 y deja de bastar desde 26", () => {
    expect(grdStructureSatisfies("coordinator", 25)).toBe(true)
    expect(grdStructureSatisfies("coordinator", 26)).toBe(false)
  })
})

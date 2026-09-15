import { describe, expect, it } from "vitest"
import { grdStructureSatisfies, resolveGrdStructure } from "./cgrd"

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

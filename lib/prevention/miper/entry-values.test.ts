import { describe, expect, it } from "vitest"
import { applyEntryValues, revertEntryFields } from "./entry-values"
import type { MiperEntrySnapshot } from "./snapshot"

const entry = { id: "e", probability: 2, consequence: 2, magnitude: 4, classification: "moderate", riskFactorId: "f1", riskFactor: "Mecánico", hazard: "H" } as MiperEntrySnapshot
const factors = [{ id: "f1", name: "Mecánico" }, { id: "f2", name: "Eléctrico" }]

describe("entry-values", () => {
  it("aplica valores, reclasifica y resuelve el nombre del factor", () => {
    const next = applyEntryValues(entry, { probability: 4, riskFactorId: "f2" }, factors)
    expect(next).toMatchObject({ probability: 4, magnitude: 8, classification: "important", riskFactor: "Eléctrico", hazard: "H" })
  })
  it("revierte sólo los campos indicados y vuelve a clasificar", () => {
    const changed = applyEntryValues(entry, { probability: 4, hazard: "X" }, factors)
    expect(revertEntryFields(changed, entry, ["probability"])).toMatchObject({ probability: 2, classification: "moderate", hazard: "X" })
  })
})

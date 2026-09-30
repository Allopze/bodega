import { describe, expect, it } from "vitest"
import { EMPTY_FILTERS, filterRows, groupRows } from "./grid-view"
import type { MiperEntrySnapshot } from "./snapshot"

const row = (id: string, over: Partial<MiperEntrySnapshot>): MiperEntrySnapshot => ({
  id, rowNumber: 1, activity: null, task: null, position: null, location: null, exposedFemale: 0, exposedMale: 0, exposedOther: 0,
  riskFactorId: null, riskFactor: null, isRoutine: null, hazard: null, risk: null, probableDamage: null, probability: null, consequence: null,
  magnitude: null, classification: null, controlledStatus: null, controls: [], ...over,
})
const rows = [
  row("a", { rowNumber: 1, activity: "Transporte", position: "Conductor", hazard: "Camión en pendiente", classification: "intolerable", controlledStatus: "no", riskFactorId: "rf-mec" }),
  row("b", { rowNumber: 2, activity: "Transporte", position: "Peoneta", hazard: "Ruido", classification: "tolerable", controlledStatus: "yes", riskFactorId: "rf-fis" }),
  row("c", { rowNumber: 3, activity: "Oficina", position: "Conductor", hazard: "Pantalla", classification: "important", controlledStatus: "partial" }),
]
const ctx = { observed: new Set(["c"]), modified: new Set(["b"]) }

describe("vista de la grilla", () => {
  it("busca sin tildes en actividad, tarea, puesto, peligro, riesgo y medidas", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, search: "camion" }, ctx).map((r) => r.id)).toEqual(["a"])
  })
  it("filtra por clasificación, controlado, factor, observadas y modificadas", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, classifications: ["important", "intolerable"] }, ctx).map((r) => r.id)).toEqual(["a", "c"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, controlled: "no" }, ctx).map((r) => r.id)).toEqual(["a"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, factorId: "rf-fis" }, ctx).map((r) => r.id)).toEqual(["b"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, onlyObserved: true }, ctx).map((r) => r.id)).toEqual(["c"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, onlyModified: true }, ctx).map((r) => r.id)).toEqual(["b"])
  })
  it("agrupa por actividad, puesto o clasificación (de mayor a menor gravedad)", () => {
    expect(groupRows(rows, "activity").map((g) => [g.label, g.rows.length])).toEqual([["Oficina", 1], ["Transporte", 2]])
    expect(groupRows(rows, "classification").map((g) => g.label)).toEqual(["Intolerable", "Importante", "Tolerable"])
    expect(groupRows(rows, "none")).toEqual([{ key: "all", label: "", rows }])
  })
})

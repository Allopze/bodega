import { describe, expect, it } from "vitest"
import { EMPTY_FILTERS, filterRows } from "./grid-view"
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
const ctx = { observed: new Set(["c"]), modified: new Set(["b"]), incomplete: new Set(["a", "c"]) }

describe("vista de la grilla", () => {
  it("busca sin tildes en actividad, tarea, puesto, peligro, riesgo y medidas", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, search: "camion" }, ctx).map((r) => r.id)).toEqual(["a"])
  })
  it("filtra por clasificación, controlado, factor, observadas, modificadas y con pendientes", () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, classifications: ["important", "intolerable"] }, ctx).map((r) => r.id)).toEqual(["a", "c"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, controlled: "no" }, ctx).map((r) => r.id)).toEqual(["a"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, factorId: "rf-fis" }, ctx).map((r) => r.id)).toEqual(["b"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, onlyObserved: true }, ctx).map((r) => r.id)).toEqual(["c"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, onlyModified: true }, ctx).map((r) => r.id)).toEqual(["b"])
    expect(filterRows(rows, { ...EMPTY_FILTERS, onlyIncomplete: true }, ctx).map((r) => r.id)).toEqual(["a", "c"])
  })
  it("onlyComplete deja sólo los riesgos sin errores", () => {
    const rows = [row("a", { id: "a" }), row("b", { id: "b" })]
    const visible = filterRows(rows, { ...EMPTY_FILTERS, onlyComplete: true }, { observed: new Set(), modified: new Set(), incomplete: new Set(["a"]) })
    expect(visible.map((row) => row.id)).toEqual(["b"])
  })
})

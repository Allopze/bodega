import { describe, expect, it } from "vitest"
import { hrefToReviewWalk, reviewQuickFilters } from "./review-walk"
import type { MiperEntrySnapshot } from "./snapshot"

const row = (id: string, rowNumber: number, classification: MiperEntrySnapshot["classification"]) => ({
  id, rowNumber, activity: "A", task: "T", position: null, location: null, exposedFemale: 0, exposedMale: 0, exposedOther: 0,
  riskFactorId: null, riskFactor: null, isRoutine: null, hazard: null, risk: null, probableDamage: null, probability: null,
  consequence: null, magnitude: null, classification, controlledStatus: null, controls: [],
}) as MiperEntrySnapshot

const rows = [row("e1", 1, "tolerable"), row("e2", 2, "important"), row("e3", 3, "intolerable"), row("e4", 4, "moderate")]

describe("reviewQuickFilters", () => {
  it("cuenta y primer riesgo por filtro, sin modificados sin línea base", () => {
    const withBaseline = reviewQuickFilters(rows, { observed: new Set(["e4"]), modified: new Set(["e3", "e1"]), hasBaseline: true })
    expect(withBaseline.map((filter) => [filter.key, filter.label, filter.count, filter.firstEntryId])).toEqual([
      ["criticos", "Importantes e Intolerables", 2, "e2"],
      ["modificados", "Modificados", 2, "e1"],
      ["observados", "Observados", 1, "e4"],
    ])
    expect(withBaseline[0]!.patch).toEqual({ clasificacion: "important,intolerable" })
    expect(withBaseline[1]!.patch).toEqual({ marca: "modificados" })
    expect(withBaseline[2]!.patch).toEqual({ marca: "observados" })

    const withoutBaseline = reviewQuickFilters(rows, { observed: new Set(), modified: new Set(["e1"]), hasBaseline: false })
    expect(withoutBaseline.map((filter) => filter.key)).toEqual(["criticos", "observados"])
    expect(withoutBaseline[1]).toMatchObject({ count: 0, firstEntryId: null })
  })
})

describe("hrefToReviewWalk", () => {
  it("el href lleva el filtro y la fila", () => {
    const href = hrefToReviewWalk("/prevencion/miper/m1", new URLSearchParams("tab=revision&buscar=ruido&clasificacion=tolerable&q=algo"), { clasificacion: "important,intolerable" }, "e2")
    const [path, query] = href.split("?")
    expect(path).toBe("/prevencion/miper/m1")
    const params = new URLSearchParams(query)
    expect(params.get("fila")).toBe("e2")
    expect(params.get("clasificacion")).toBe("important,intolerable")
    // Los demás filtros de la matriz y la pestaña no se arrastran; los del programa sí se conservan.
    expect(params.get("buscar")).toBeNull()
    expect(params.get("tab")).toBeNull()
    expect(params.get("q")).toBe("algo")
  })
})

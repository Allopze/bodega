import { describe, expect, it } from "vitest"
import { EMPTY_FILTERS } from "./grid-view"
import { hasEntryFilters, matrixFilterChips, matrixFilterPatch, parseMatrixFilters } from "./matrix-filters"

const params = (query: string) => new URLSearchParams(query)

describe("filtros de la matriz en la URL", () => {
  it("lee cada clave y descarta valores desconocidos", () => {
    const filters = parseMatrixFilters(params("buscar=lodo&clasificacion=foo,important,important&controlado=quizas&completitud=pendientes&marca=observados&factor=f1"))
    expect(filters).toEqual({ ...EMPTY_FILTERS, search: "lodo", classifications: ["important"], controlled: "all", onlyIncomplete: true, onlyObserved: true, factorId: "f1" })
  })
  it("ida y vuelta: patch → URL → mismos filtros; vacío borra todas las claves", () => {
    const filters = { ...EMPTY_FILTERS, classifications: ["important" as const, "intolerable" as const], controlled: "no" as const, onlyComplete: true, onlyModified: true }
    const patch = matrixFilterPatch(filters)
    const url = new URLSearchParams(Object.entries(patch).flatMap(([key, value]) => (value ? [[key, value]] : [])))
    expect(parseMatrixFilters(url)).toEqual(filters)
    expect(Object.values(matrixFilterPatch(EMPTY_FILTERS)).every((value) => value === null)).toBe(true)
  })
  it("chips legibles con la clave de la URL para quitarlos", () => {
    const chips = matrixFilterChips({ ...EMPTY_FILTERS, classifications: ["important"], factorId: "f1", onlyIncomplete: true }, [{ id: "f1", name: "Mecánico" }])
    expect(chips.map((chip) => [chip.key, chip.displayValue])).toEqual([["clasificacion", "Importante"], ["completitud", "Con pendientes"], ["factor", "Mecánico"]])
    expect(hasEntryFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasEntryFilters({ ...EMPTY_FILTERS, search: "x" })).toBe(true)
  })
})

import { describe, expect, it } from "vitest"
import { hrefToEntry, hrefToFicha, hrefToMatrix, hrefToMatrixWith, hrefToTab, hrefToTask, readWorkspaceView } from "./workspace-url"

const P = "/prevencion/miper/m1"
const params = (query: string) => new URLSearchParams(query)

describe("vistas del espacio de trabajo", () => {
  it("fila > tarea > pestaña; la matriz es la pestaña por defecto", () => {
    expect(readWorkspaceView(params("tab=programa&fila=e1&paso=medidas"))).toEqual({ tab: "matriz", taskKey: null, entryId: "e1", step: "medidas", ficha: false })
    expect(readWorkspaceView(params("tarea=k1"))).toMatchObject({ tab: "matriz", taskKey: "k1", entryId: null })
    expect(readWorkspaceView(params("tab=nada"))).toMatchObject({ tab: "matriz" })
    expect(readWorkspaceView(params("paso=x&fila=e1")).step).toBeNull()
  })
  it("`tab=antecedentes` (enlace heredado) abre la ficha", () => {
    expect(readWorkspaceView(params("tab=antecedentes"))).toMatchObject({ tab: "matriz", ficha: true })
    expect(readWorkspaceView(params("ficha=1"))).toMatchObject({ ficha: true })
  })
  it("los enlaces conservan los filtros y limpian la vista anterior", () => {
    const current = params("clasificacion=important&tarea=k1&tab=revision")
    expect(hrefToEntry(P, current, "e9", "evaluacion")).toBe(`${P}?clasificacion=important&fila=e9&paso=evaluacion`)
    expect(hrefToTask(P, params("fila=e9&paso=medidas&buscar=lodo"), "k2")).toBe(`${P}?buscar=lodo&tarea=k2`)
    expect(hrefToMatrix(P, current)).toBe(`${P}?clasificacion=important`)
    expect(hrefToTab(P, current, "programa")).toBe(`${P}?clasificacion=important&tab=programa`)
    expect(hrefToTab(P, params("tab=revision"), "matriz")).toBe(P)
    expect(hrefToFicha(P, params("tarea=k1"), true)).toBe(`${P}?tarea=k1&ficha=1`)
    expect(hrefToFicha(P, params("tab=antecedentes&ficha=1"), false)).toBe(P)
    expect(hrefToMatrixWith(P, params("tab=revision&buscar=x"), { completitud: "pendientes" })).toBe(`${P}?buscar=x&completitud=pendientes`)
  })
})

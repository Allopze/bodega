import { describe, expect, it } from "vitest"
import { hrefToEntry, hrefToFicha, hrefToMatrix, hrefToMatrixOnly, hrefToMatrixWith, hrefToProgramOnly, hrefToTab, hrefToTask, PROGRAM_FILTER_KEYS, readWorkspaceView } from "./workspace-url"

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

  it("hrefToEntry sin paso quita el `paso` anterior: el editor abre en el primer paso con errores", () => {
    expect(hrefToEntry(P, params("fila=e1&paso=medidas&buscar=lodo"), "e2")).toBe(`${P}?fila=e2&buscar=lodo`)
  })

  it("Resumen (Fase B): `tab=resumen` es una pestaña; la fila y la tarea siguen mandando sobre ella", () => {
    expect(readWorkspaceView(params("tab=resumen"))).toMatchObject({ tab: "resumen", taskKey: null, entryId: null })
    expect(readWorkspaceView(params("tab=resumen&tarea=k1"))).toMatchObject({ tab: "matriz", taskKey: "k1" })
    expect(hrefToTab(P, params("buscar=x"), "resumen")).toBe(`${P}?buscar=x&tab=resumen`)
  })

  it("hrefToMatrixOnly quita los seis filtros de la matriz, la vista y la ficha antes de aplicar el suyo", () => {
    const current = params("buscar=lodo&clasificacion=moderate&completitud=completos&controlado=yes&factor=f1&marca=observados&tab=resumen&ficha=1&q=prog")
    // `q` es del programa: no es un filtro de la matriz y se conserva.
    expect(hrefToMatrixOnly(P, current, { clasificacion: "important,intolerable" })).toBe(`${P}?q=prog&clasificacion=important%2Cintolerable`)
    expect(hrefToMatrixOnly(P, current)).toBe(`${P}?q=prog`)
  })

  it("hrefToProgramOnly abre el programa entero: quita sus filtros (q, estado, frecuencia) y la vista; los de la matriz no lo afectan", () => {
    expect(PROGRAM_FILTER_KEYS).toEqual(["q", "estado", "frecuencia"])
    const current = params("estado=vencidas&q=bomba&tab=resumen&buscar=lodo&frecuencia=monthly&tarea=k1")
    expect(hrefToProgramOnly(P, current)).toBe(`${P}?buscar=lodo&tab=programa`)
    expect(hrefToProgramOnly(P, params(""))).toBe(`${P}?tab=programa`)
  })
})

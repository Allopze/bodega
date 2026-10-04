import { describe, expect, it } from "vitest"
import { hrefToMatrixPresentation, hrefToActivity, hrefToEntry, hrefToFicha, hrefToMatrix, hrefToMatrixOnly, hrefToMatrixWith, hrefToProgramOnly, hrefToTab, hrefToTask, PROGRAM_FILTER_KEYS, readWorkspaceView } from "./workspace-url"

const P = "/prevencion/miper/m1"
const params = (query: string) => new URLSearchParams(query)

describe("vistas del espacio de trabajo", () => {
  it("fila > tarea > pestaña; la matriz es la pestaña por defecto", () => {
    expect(readWorkspaceView(params("tab=programa&fila=e1&paso=medidas"))).toEqual({ tab: "matriz", taskKey: null, entryId: "e1", activityId: null, step: "medidas", ficha: false })
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

describe("actividad del programa (?actividad=)", () => {
  it("fila gana sobre actividad y actividad sobre tarea", () => {
    expect(readWorkspaceView(params("fila=e1&actividad=a1&tarea=k1"))).toMatchObject({ entryId: "e1", activityId: null, taskKey: null, tab: "matriz" })
    expect(readWorkspaceView(params("actividad=a1&tarea=k1"))).toMatchObject({ entryId: null, activityId: "a1", taskKey: null })
  })
  it("con actividad la pestaña es programa aunque diga otra", () => {
    expect(readWorkspaceView(params("tab=revision&actividad=a1"))).toMatchObject({ tab: "programa", activityId: "a1" })
  })
  it("hrefToActivity limpia fila, tarea y paso y conserva los filtros", () => {
    expect(hrefToActivity(P, params("fila=e1&paso=medidas&tarea=k1&estado=activas&q=lodo"), "a9")).toBe(`${P}?estado=activas&q=lodo&tab=programa&actividad=a9`)
  })
  it("hrefToTab, hrefToEntry y hrefToProgramOnly limpian actividad", () => {
    const current = params("tab=programa&actividad=a1&estado=activas")
    // `set` deja `tab` en su lugar: el orden de la query no cambia el significado.
    expect(hrefToTab(P, current, "programa")).toBe(`${P}?tab=programa&estado=activas`)
    expect(hrefToEntry(P, current, "e1")).toBe(`${P}?estado=activas&fila=e1`)
    expect(hrefToProgramOnly(P, current)).toBe(`${P}?tab=programa`)
  })
})

 it("resultados es una presentación: conserva filtros al entrar y volver a una tarea", () => {
   const target = hrefToMatrixPresentation(P, params("tab=resumen&buscar=lodo"), "resultados")
   expect(target).toBe(`${P}?buscar=lodo&vista=resultados`)
   expect(hrefToEntry(P, params("vista=resultados"), "e1")).toBe(`${P}?vista=resultados&fila=e1`)
   expect(hrefToMatrix(P, params("vista=resultados&fila=e1"))).toBe(`${P}?vista=resultados`)
   expect(hrefToMatrixPresentation(P, params("vista=resultados&buscar=lodo"), "estructura")).toBe(`${P}?vista=estructura&buscar=lodo`)
   expect(hrefToMatrixOnly(P, params("vista=resultados&buscar=lodo"))).toBe(P)
 })

// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildMatrixTree } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const nav = vi.hoisted(() => ({ query: "" }))
vi.mock("next/navigation", () => ({ usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams(nav.query) }))

import { ResumenPanel } from "./resumen-panel"

const P = "/prevencion/miper/m1"
const entry = (overrides: Partial<MiperEntrySnapshot>): MiperEntrySnapshot => ({
  id: "e1", rowNumber: 1, activity: "Transporte", task: "Carga", position: "Conductor", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0,
  riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true, hazard: "Peligro", risk: "Choque", probableDamage: "Fractura",
  probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no", controls: [],
  ...overrides,
})
const ROWS = [
  entry({}),
  entry({ id: "e2", rowNumber: 2, activity: "Mantención", task: "Revisión", probability: 1, consequence: 2, magnitude: 2, classification: "tolerable", controlledStatus: "yes" }),
  entry({ id: "e3", rowNumber: 3, activity: "Mantención", task: "Revisión", probability: 4, consequence: 4, magnitude: 16, classification: "intolerable", controlledStatus: "partial" }),
]
const INCOMPLETE = new Set(["e1", "e3"])
const treeOf = (rows: MiperEntrySnapshot[], incomplete: ReadonlySet<string>) => buildMatrixTree(rows, { incomplete, observed: new Set(), modified: new Set(), matching: null })
const PROGRESS = { done: 1, late: 0, pending: 1, overdue: 0, failed: 1, planned: 3, ratio: 1 / 3 }
const NO_PROGRAM = { done: 0, late: 0, pending: 0, overdue: 0, failed: 0, planned: 0, ratio: null }

function show(query = "", rows = ROWS, incomplete: ReadonlySet<string> = INCOMPLETE, onNewTask = vi.fn(), linked: ReadonlySet<string> = new Set()) {
  nav.query = query
  return render(<ResumenPanel matrixId="m1" rows={rows} tree={treeOf(rows, incomplete)} incomplete={incomplete} linkedControlIds={linked} programProgress={rows === ROWS ? PROGRESS : NO_PROGRAM} editable onNewTask={onNewTask} />)
}

afterEach(() => {
  nav.query = ""
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("ResumenPanel — cuatro cifras que llevan a su subconjunto (A1)", () => {
  it("cada cifra de la matriz quita los filtros que había antes de aplicar el suyo", () => {
    // La URL tal como la deja el espacio de trabajo: filtrar la matriz y después abrir «Resumen» agrega `tab` al final.
    show("buscar=lodo&factor=f1&clasificacion=moderate&tab=resumen")
    const completos = screen.getByRole("link", { name: /^Riesgos completos/ })
    expect(completos).toHaveAttribute("href", `${P}?completitud=completos`)
    expect(completos).toHaveTextContent("1/3")
    expect(completos).toHaveTextContent("2 riesgos con pendientes")
    expect(screen.getByRole("link", { name: /^Importantes e Intolerables/ })).toHaveAttribute("href", `${P}?clasificacion=important%2Cintolerable`)
    expect(screen.getByRole("link", { name: /^No controlados/ })).toHaveAttribute("href", `${P}?controlado=no`)
    // El programa no lee los filtros de la matriz: se conservan.
    const programa = screen.getByRole("link", { name: /^Avance del plan/ })
    expect(programa).toHaveAttribute("href", `${P}?buscar=lodo&factor=f1&clasificacion=moderate&tab=programa`)
    expect(programa).toHaveTextContent("33%")
    expect(programa).toHaveTextContent("1/3 realizadas")
  })

  it("«Avance del plan» lleva al programa entero: quita los filtros del programa que hubiera (A1)", () => {
    // El avance de la cifra es el de todo el programa; llegar a la lista filtrada por `estado` no coincidiría.
    show("estado=vencidas&q=bomba&frecuencia=monthly&tab=resumen")
    expect(screen.getByRole("link", { name: /^Avance del plan/ })).toHaveAttribute("href", `${P}?tab=programa`)
  })

  it("una cifra en cero no lleva a una lista vacía; sin pendientes, «Riesgos completos» lleva a los completos", () => {
    const tolerable = [ROWS[1]!]
    show("", tolerable, new Set())
    expect(screen.queryByRole("link", { name: /^No controlados/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /^Importantes e Intolerables/ })).toBeNull()
    expect(screen.getByRole("link", { name: /^Riesgos completos/ })).toHaveAttribute("href", `${P}?completitud=completos`)
    expect(screen.getByRole("link", { name: /^Avance del plan/ })).toHaveTextContent("Aún sin actividades")
  })

  it("«Avance del plan» redondea hacia abajo: 199 de 200 no es 100% (y 29 de 100 es 29%, sin el error de coma flotante)", () => {
    const at = (done: number, planned: number) => {
      nav.query = ""
      return render(<ResumenPanel matrixId="m1" rows={ROWS} tree={treeOf(ROWS, INCOMPLETE)} incomplete={INCOMPLETE} linkedControlIds={new Set()} editable onNewTask={vi.fn()}
        programProgress={{ done, late: 0, pending: planned - done, overdue: 0, failed: 0, planned, ratio: done / planned }} />)
    }
    const first = at(199, 200)
    expect(screen.getByRole("link", { name: /^Avance del plan/ })).toHaveTextContent(/^Avance del plan99%/)
    first.unmount()
    at(29, 100)
    expect(screen.getByRole("link", { name: /^Avance del plan/ })).toHaveTextContent(/^Avance del plan29%/)
  })

  it("sin riesgos, el estado vacío explica y ofrece «Nueva tarea» (A4)", () => {
    const onNewTask = vi.fn()
    show("", [], new Set(), onNewTask)
    expect(screen.getByText("Esta MIPER todavía no tiene riesgos")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Nueva tarea" }))
    expect(onNewTask).toHaveBeenCalled()
  })
})

describe("ResumenPanel — textos y seguimiento", () => {
  const control = (id: string) => ({ id, description: "Medida", type: "administrative" }) as unknown as MiperEntrySnapshot["controls"][number]
  it("cuenta cuántos importantes e intolerables ya tienen actividad en el plan", () => {
    const rows = [entry({ controls: [control("c1")] }), ROWS[1]!, ROWS[2]!]
    show("", rows, INCOMPLETE, vi.fn(), new Set(["c1"]))
    expect(screen.getByRole("link", { name: /^Importantes e Intolerables/ })).toHaveTextContent("Exigen seguimiento · 1 con actividad en el plan")
  })

  it("si todos los graves tienen actividad lo dice, y sin graves no promete seguimiento", () => {
    const all = [entry({ controls: [control("c1")] })]
    const first = show("", all, INCOMPLETE, vi.fn(), new Set(["c1"]))
    expect(screen.getByRole("link", { name: /^Importantes e Intolerables/ })).toHaveTextContent("Exigen seguimiento · todos con actividad en el plan")
    first.unmount()
    show("", [ROWS[1]!], new Set())
    expect(screen.getByText("Ninguno en esta MIPER")).toBeInTheDocument()
    expect(screen.getByText("Ninguno marcado como no controlado")).toBeInTheDocument()
  })

  it("«Ver riesgos» abre la pestaña de riesgos; el avance vacío dice qué hacer", () => {
    show("", [ROWS[1]!], new Set())
    expect(screen.getByRole("link", { name: "Ver riesgos" })).toHaveAttribute("href", P)
    expect(screen.getByRole("link", { name: /^Avance del plan/ })).toHaveTextContent("Genéralas desde las medidas")
  })
})

describe("ResumenPanel — completitud por actividad", () => {
  it("si todas las actividades están completas, una sola línea en vez de la lista de barras", () => {
    show("", [ROWS[1]!], new Set())
    expect(screen.getByText("La única actividad tiene todos sus datos.")).toBeInTheDocument()
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0)
    expect(screen.getByRole("heading", { name: "Datos completos por actividad" })).toBeInTheDocument()
  })

  it("con varias actividades completas, cuenta cuántas", () => {
    const rows = [ROWS[1]!, entry({ id: "e4", activity: "Bodega", task: "Orden", classification: "tolerable", controlledStatus: "yes" })]
    show("", rows, new Set())
    expect(screen.getByText("Las 2 actividades tienen todos sus datos.")).toBeInTheDocument()
  })

  it("una barra por actividad, en el orden del RE-04, con su cuenta", () => {
    show("")
    expect(screen.getByRole("progressbar", { name: "Transporte: 0 de 1 completos" })).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: "Mantención: 1 de 2 completos" })).toBeInTheDocument()
  })

  it("el nombre de la actividad se lee entero: parte en líneas en vez de recortarse con «…»", () => {
    show("")
    const name = screen.getByRole("link", { name: "Mantención" })
    expect(name).not.toHaveClass("truncate")
    expect(name).toHaveClass("break-words")
  })

  it("el enlace a una actividad plegada la despliega, quita los filtros y la deja a la vista con el foco", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0 })
    const tree = treeOf(ROWS, INCOMPLETE)
    const key = tree[1]!.key
    sessionStorage.setItem("miper:m1:collapsed", JSON.stringify([key]))
    const replace = vi.spyOn(window.history, "replaceState")
    show("tab=resumen&buscar=lodo")
    // El destino lo pinta MatrixView al cambiar de pestaña; aquí se simula ya pintado.
    const target = document.createElement("h2")
    target.id = `miper-activity-${key}`
    target.innerHTML = "<button type=\"button\">Mantención</button>"
    target.scrollIntoView = vi.fn()
    document.body.appendChild(target)
    try {
      fireEvent.click(screen.getByRole("link", { name: "Mantención" }))
      expect(replace).toHaveBeenCalledWith(null, "", `${P}#miper-activity-${key}`)
      expect(JSON.parse(sessionStorage.getItem("miper:m1:collapsed")!)).toEqual([])
      expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" })
      expect(document.activeElement).toBe(target.querySelector("button"))
    } finally {
      target.remove()
    }
  })
})

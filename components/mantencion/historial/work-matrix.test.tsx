// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { bucketLabel } from "@/lib/indicators/period"
import { HISTORY_PATH, MATRIX_MAX_ROWS, buildWorkMatrix, parseHistoryParams } from "@/lib/mantencion/history-view"
import type { MaintenanceHistoryRow } from "@/lib/services/mantencion/maintenance-work"
import { WorkMatrixView, cellBreakdown, cellSurface } from "./work-matrix"

const TODAY = "2026-11-25"
const MONTHS = ["2026-09", "2026-10", "2026-11"]
const CAPTION = "Trabajos por equipo y mes"
const [SEP, OCT, NOV] = MONTHS.map((month) => bucketLabel(month, "month"))

type Source = Pick<MaintenanceHistoryRow, "vehicleId" | "equipmentLabel" | "worksiteName" | "date" | "actionType">

function work(overrides: Partial<Source>): Source {
  return { vehicleId: "veh-1", equipmentLabel: "KA-79", worksiteName: "Santa Fe", date: "2026-09-02", actionType: "preventiva", ...overrides }
}

/**
 * KA-79 (Santa Fe): sep = 2 correctivas + 1 preventiva (mixta), nov = 1 correctiva; el de agosto queda fuera de los meses.
 * KA-12 (Santa Fe): oct = 1 predictiva. TO-37 (sin faena): oct = 1 correctiva + 1 preventiva (mixta).
 * Dos trabajos sin equipo en oct y nov. Orden esperado: Santa Fe primero (KA-79 antes que KA-12 por correctivas), «Sin faena» al final.
 */
const ROWS: Source[] = [
  work({ date: "2026-09-02", actionType: "preventiva" }),
  work({ date: "2026-09-20", actionType: "correctiva" }),
  work({ date: "2026-09-21", actionType: "correctiva" }),
  work({ date: "2026-11-01", actionType: "correctiva" }),
  work({ date: "2026-08-15", actionType: "correctiva" }),
  work({ vehicleId: "veh-2", equipmentLabel: "KA-12", date: "2026-10-10", actionType: "predictiva" }),
  work({ vehicleId: "veh-3", equipmentLabel: "TO-37", worksiteName: null, date: "2026-10-03", actionType: "correctiva" }),
  work({ vehicleId: "veh-3", equipmentLabel: "TO-37", worksiteName: null, date: "2026-10-04", actionType: "preventiva" }),
  work({ vehicleId: null, equipmentLabel: "", worksiteName: null, date: "2026-10-05", actionType: "correctiva" }),
  work({ vehicleId: null, equipmentLabel: "", worksiteName: null, date: "2026-11-06", actionType: "preventiva" }),
]

const params = parseHistoryParams({ vista: "matriz" }, TODAY)

function renderMatrix(rows: Source[] = ROWS, view = params) {
  return render(<WorkMatrixView matrix={buildWorkMatrix(rows, MONTHS)} params={view} />)
}

/** El párrafo entero: `getByText` sólo mira los nodos de texto directos, y aquí el enlace va dentro del párrafo. */
function paragraph(text: string) {
  return screen.getByText((_, node) => node?.tagName === "P" && node.textContent === text)
}

describe("WorkMatrixView — la matriz equipos × meses", () => {
  it("es una tabla con nombre accesible y una columna por mes, más el total", () => {
    const { container } = renderMatrix()
    const table = screen.getByRole("table", { name: CAPTION })
    const head = table.querySelector("thead") as HTMLElement
    expect(within(head).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Equipo", SEP, OCT, NOV, "Total"])
    expect(container.querySelectorAll("thead tr")).toHaveLength(1)
  })

  it("agrupa por faena: una fila de faena por grupo, «Sin faena» al final", () => {
    const { container } = renderMatrix()
    const groupRows = [...container.querySelectorAll("tbody tr")].filter((tr) => tr.querySelector("td") === null)
    expect(groupRows.map((tr) => tr.textContent)).toEqual(["Santa Fe", "Sin faena"])
    expect([...container.querySelectorAll('th[scope="row"]')].map((th) => th.textContent)).toEqual(["KA-79", "KA-12", "TO-37"])
  })

  it("cada celda con trabajo enlaza al equipo y al mes, con el período de ese mes", () => {
    renderMatrix()
    const sep = screen.getByRole("link", { name: `KA-79, ${SEP}: 3 trabajos: 2 correctivas, 1 preventiva` })
    expect(sep.getAttribute("href")).toBe(`${HISTORY_PATH}?equipo=veh-1&desde=2026-09-01&hasta=2026-09-30`)
    const nov = screen.getByRole("link", { name: `KA-79, ${NOV}: 1 trabajo: 1 correctiva` })
    expect(nov.getAttribute("href")).toBe(`${HISTORY_PATH}?equipo=veh-1&desde=2026-11-01&hasta=2026-11-30`)
  })

  it("los filtros vigentes viajan con la celda; el tipo se quita para mostrar todos los trabajos del mes", () => {
    renderMatrix(ROWS, parseHistoryParams({ vista: "matriz", faena: "ws-1", origen: "ot", tipo: "correctiva" }, TODAY))
    const sep = screen.getByRole("link", { name: `KA-79, ${SEP}: 3 trabajos: 2 correctivas, 1 preventiva` })
    expect(sep.getAttribute("href")).toBe(`${HISTORY_PATH}?equipo=veh-1&faena=ws-1&desde=2026-09-01&hasta=2026-09-30&origen=ot`)
  })

  it("el nombre del equipo y la columna Total enlazan a su historial completo", () => {
    renderMatrix()
    const name = screen.getByRole("link", { name: "KA-79" })
    expect(name.getAttribute("href")).toBe(`${HISTORY_PATH}?equipo=veh-1`)
    const total = screen.getByRole("link", { name: "KA-79, total: 4 trabajos, 3 correctivas" })
    expect(total.getAttribute("href")).toBe(`${HISTORY_PATH}?equipo=veh-1`)
    expect(within(total).getByText("4")).toBeDefined()
    expect(within(total).getByText("3 correctivas")).toBeDefined()
  })

  it("el tipo no depende del color: la letra acompaña al número, la mixta lo marca y el desglose queda accesible", () => {
    renderMatrix()
    const mixed = screen.getByRole("link", { name: `KA-79, ${SEP}: 3 trabajos: 2 correctivas, 1 preventiva` })
    expect(mixed.getAttribute("data-kind")).toBe("mixta")
    expect(mixed.textContent).toBe("3M")
    const correctiva = screen.getByRole("link", { name: `KA-79, ${NOV}: 1 trabajo: 1 correctiva` })
    expect(correctiva.getAttribute("data-kind")).toBe("correctiva")
    expect(correctiva.textContent).toBe("1C")
    const predictiva = screen.getByRole("link", { name: `KA-12, ${OCT}: 1 trabajo: 1 predictiva` })
    expect(predictiva.getAttribute("data-kind")).toBe("predictiva")
    expect(predictiva.textContent).toBe("1Pd")
  })

  it("una celda vacía se anuncia como «Sin trabajos» y no es un enlace", () => {
    renderMatrix()
    // KA-79 oct, KA-12 sep y nov, TO-37 sep y nov.
    expect(screen.getAllByText("Sin trabajos")).toHaveLength(5)
    expect(screen.queryByRole("link", { name: /Sin trabajos/ })).toBeNull()
  })

  it("la leyenda nombra los cinco tipos y dice cómo abrir los trabajos de una celda", () => {
    renderMatrix()
    const legend = screen.getByRole("list", { name: "Leyenda de tipos" })
    for (const label of ["Correctiva", "Preventiva", "Predictiva", "Sin clasificar", "Varios tipos"]) {
      expect(within(legend).getByText(label)).toBeDefined()
    }
    expect(screen.getByText("Toca una celda para ver sus trabajos.")).toBeDefined()
    expect(screen.queryByText(/Cada celda cuenta/)).toBeNull()
  })

  it("el contenedor de la tabla desplaza en horizontal y es foco de teclado; la primera columna queda fija", () => {
    renderMatrix()
    const region = screen.getByRole("region", { name: CAPTION })
    expect(region.className).toContain("overflow-x-auto")
    // `relative`: el texto `sr-only` de las celdas vacías es `absolute` y, sin un ancestro posicionado dentro del recorte,
    // su posición (a la derecha de la tabla) ensancha la página en el teléfono.
    expect(region.className).toContain("relative")
    expect(region.getAttribute("tabindex")).toBe("0")
    const firstHeader = region.querySelector("thead th") as HTMLElement
    expect(firstHeader.className).toContain("sticky left-0")
    expect(region.querySelector('th[scope="row"]')?.className).toContain("sticky left-0")
  })

  it("con más equipos que el tope, muestra el tope y avisa cuántos quedan fuera (en singular y en plural)", () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => work({
      vehicleId: `v-${index}`, equipmentLabel: `EQ-${String(index).padStart(3, "0")}`, date: "2026-10-01", actionType: "correctiva",
    }))
    const { container, unmount } = renderMatrix(many(MATRIX_MAX_ROWS + 2))
    expect(container.querySelectorAll('th[scope="row"]')).toHaveLength(MATRIX_MAX_ROWS)
    expect(screen.getByText(`Se muestran los ${MATRIX_MAX_ROWS} equipos con más correctivas; hay 2 equipos más. Filtra por faena para verlos.`)).toBeDefined()
    unmount()
    renderMatrix(many(MATRIX_MAX_ROWS + 1))
    expect(screen.getByText(`Se muestran los ${MATRIX_MAX_ROWS} equipos con más correctivas; hay 1 equipo más. Filtra por faena para verlos.`)).toBeDefined()
  })

  it("avisa de los trabajos sin equipo con un enlace a «Respuestas de formularios»", () => {
    renderMatrix()
    const note = paragraph("2 trabajos sin equipo identificado no aparecen aquí; se resuelven en “Respuestas de formularios”.")
    expect(within(note).getByRole("link", { name: "Respuestas de formularios" }).getAttribute("href")).toBe(`${HISTORY_PATH}?vista=formularios`)
  })

  it("el aviso de sin equipo va en singular cuando es uno", () => {
    renderMatrix([work({ vehicleId: null, equipmentLabel: "", worksiteName: null, date: "2026-10-05" }), ROWS[0]!])
    paragraph("1 trabajo sin equipo identificado no aparece aquí; se resuelve en “Respuestas de formularios”.")
  })

  it("sin trabajos con equipo dice qué pasa en lenguaje de usuario y ofrece ver todo el historial", () => {
    renderMatrix([])
    expect(screen.getByRole("heading", { name: "No hay trabajos en estos meses" })).toBeDefined()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByRole("link", { name: "Ver todo el historial" }).getAttribute("href")).toBe(`${HISTORY_PATH}?vista=matriz&periodo=todo`)
  })

  it("sin trabajos y con el período completo, no ofrece un enlace que no cambia nada", () => {
    renderMatrix([], parseHistoryParams({ vista: "matriz", periodo: "todo" }, TODAY))
    expect(screen.getByRole("heading", { name: "No hay trabajos en estos meses" })).toBeDefined()
    expect(screen.queryByRole("link", { name: "Ver todo el historial" })).toBeNull()
  })

  it("aunque no haya trabajos con equipo, el aviso de los trabajos sin equipo no se pierde", () => {
    renderMatrix([work({ vehicleId: null, equipmentLabel: "", worksiteName: null, date: "2026-10-05" })])
    expect(screen.getByRole("heading", { name: "No hay trabajos en estos meses" })).toBeDefined()
    expect(screen.getByText(/1 trabajo sin equipo identificado no aparece aquí/)).toBeDefined()
  })
})

describe("cellBreakdown y cellSurface", () => {
  it("el desglose nombra cada tipo en plural o singular, con el total primero", () => {
    expect(cellBreakdown({ total: 1, correctiva: 1, preventiva: 0, predictiva: 0, sin_clasificar: 0 })).toBe("1 trabajo: 1 correctiva")
    expect(cellBreakdown({ total: 2, correctiva: 0, preventiva: 0, predictiva: 0, sin_clasificar: 2 })).toBe("2 trabajos: 2 sin clasificar")
    expect(cellBreakdown({ total: 3, correctiva: 2, preventiva: 1, predictiva: 0, sin_clasificar: 0 })).toBe("3 trabajos: 2 correctivas, 1 preventiva")
  })

  it("el fondo es un token del tipo (sin hex) que se intensifica con el conteo; la mixta es neutra", () => {
    for (const kind of ["correctiva", "preventiva", "predictiva", "sin_clasificar"] as const) {
      expect(cellSurface(kind, 1, 1)).toMatch(/^color-mix\(in oklab, var\(--color-[a-z0-9-]+\) \d+%, var\(--color-surface\)\)$/)
    }
    expect(cellSurface("correctiva", 1, 2)).toContain("22%")
    expect(cellSurface("correctiva", 2, 2)).toContain("32%")
    expect(cellSurface("mixta", 2, 2)).toBe("var(--color-surface-2)")
  })
})

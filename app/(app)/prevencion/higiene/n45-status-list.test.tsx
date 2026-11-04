// @vitest-environment jsdom
/**
 * Sustituye al calendario de cumplimiento de Higiene: la evaluación cuantitativa N°45 es UNA
 * casilla al año por faena, así que el calendario era 1 celda exigible de 12 por fila. Una
 * lista por faena —hecha / pendiente, con su fecha y un enlace a su panel— dice lo mismo.
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { N45StatusList } from "./n45-status-list"
import { shapeN45Status } from "./n45-status"

afterEach(cleanup)

const worksites = [
  { id: "ws-a", name: "Faena Alfa" },
  { id: "ws-b", name: "Faena Beta" },
  { id: "ws-c", name: "Faena Gamma" },
]

function renderList() {
  const model = shapeN45Status(worksites, [
    { worksiteId: "ws-a", status: "completed", scheduledMonth: 2, measuredOn: "2026-02-12", groupCode: "SIO2-A" },
    { worksiteId: "ws-b", status: "pending", scheduledMonth: 2, measuredOn: null, groupCode: null },
  ])
  return render(<N45StatusList model={model} year={2026} />)
}

describe("N45StatusList", () => {
  it("es una lista, no un calendario: sin tabla ni columnas de meses", () => {
    const { container } = renderList()
    expect(container.querySelector("table")).toBeNull()
    expect(screen.getByRole("list", { name: "Evaluación cuantitativa N°45 por faena" })).toBeDefined()
    expect(screen.getByRole("heading", { name: "Evaluación cuantitativa N°45 · 2026" })).toBeDefined()
  })

  it("dice cuántas faenas la tienen hecha", () => {
    renderList()
    expect(screen.getByText("1 de 2 faenas con la evaluación hecha")).toBeDefined()
  })

  it("una faena hecha dice «Hecha» con la fecha de la medición y su GES", () => {
    renderList()
    const row = screen.getByRole("link", { name: "Faena Alfa" }).closest("li")!
    expect(within(row).getByText("Hecha")).toBeDefined()
    expect(row.textContent).toContain("Medición del 12-02-2026")
    expect(row.textContent).toContain("GES SIO2-A")
  })

  it("una faena pendiente dice «Pendiente» y el mes en que el programa la espera", () => {
    renderList()
    const row = screen.getByRole("link", { name: "Faena Beta" }).closest("li")!
    expect(within(row).getByText("Pendiente")).toBeDefined()
    expect(row.textContent).toContain("Programada para febrero")
  })

  it("una faena sin casilla no se da por hecha ni pendiente: lo dice", () => {
    renderList()
    const row = screen.getByRole("link", { name: "Faena Gamma" }).closest("li")!
    expect(within(row).getByText("Sin casilla")).toBeDefined()
    expect(row.textContent).toContain("se genera al activar la faena en el programa")
  })

  it("cada faena enlaza a su panel de protocolos (la misma pantalla)", () => {
    renderList()
    const link = screen.getByRole("link", { name: "Faena Alfa" })
    expect(link.getAttribute("href")).toBe("/prevencion/higiene?tab=protocols&faena=ws-a&anio=2026")
  })

  it("sin faenas no pinta nada: el panel de protocolos ya explica el vacío", () => {
    const { container } = render(<N45StatusList model={shapeN45Status([], [])} year={2026} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("si ninguna faena tiene casilla exigible no inventa «0 de 0»", () => {
    render(<N45StatusList model={shapeN45Status([{ id: "ws-a", name: "Faena Alfa" }], [])} year={2026} />)
    expect(screen.queryByText(/faenas? con la evaluación hecha/)).toBeNull()
  })
})

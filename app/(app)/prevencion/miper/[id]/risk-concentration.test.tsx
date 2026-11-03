// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"

const nav = vi.hoisted(() => ({ query: "" }))
vi.mock("next/navigation", () => ({ usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams(nav.query) }))

import { RiskConcentration } from "./risk-concentration"

const P = "/prevencion/miper/m1"
const entry = (id: string, probability: number | null, consequence: number | null, extra: Partial<MiperEntrySnapshot> = {}): MiperEntrySnapshot => ({
  id, rowNumber: 1, activity: "Transporte", task: "Carga", position: "Conductor", location: null, exposedFemale: 0, exposedMale: 1, exposedOther: 0,
  riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true, hazard: "Peligro", risk: "Choque", probableDamage: "Fractura",
  probability, consequence, magnitude: probability && consequence ? probability * consequence : null,
  classification: probability && consequence ? (probability * consequence <= 2 ? "tolerable" : probability * consequence === 4 ? "moderate" : probability * consequence === 8 ? "important" : "intolerable") : null,
  controlledStatus: "no", controls: [], ...extra,
})
const ROWS = [entry("e1", 4, 2), entry("e2", 4, 2), entry("e3", 4, 2), entry("e4", 2, 4), entry("e5", 1, 1), entry("e6", 1, 1), entry("e7", null, 2)]

function show(rows = ROWS, residual: Record<string, string> = {}, uncontrolled = 7, query = "") {
  nav.query = query
  return render(<RiskConcentration rows={rows} residualLevels={residual} uncontrolled={uncontrolled} />)
}

afterEach(() => { nav.query = "" })

describe("RiskConcentration — dónde se concentra el riesgo", () => {
  it("es una figura con nombre y una frase que responde la pregunta antes del dibujo", () => {
    show()
    const figure = screen.getByRole("figure", { name: "Dónde se concentra el riesgo" })
    expect(within(figure).getByText("4 de 6 riesgos evaluados son Importantes o Intolerables; la celda más cargada es probabilidad Alta × consecuencia Media (P4 × C2), con 3 riesgos.")).toBeDefined()
  })

  it("dibuja el inherente como tabla de 9 celdas y deja fuera de la grilla al que no tiene P o C", () => {
    show()
    const table = screen.getByRole("table", { name: /^Riesgo inherente/ })
    expect(within(table).getAllByRole("cell")).toHaveLength(9)
    expect(within(table).getAllByRole("cell")[1]!.textContent).toBe("3 riesgos, Importante")
    expect(screen.getByText(/1 riesgo sin evaluar/)).toBeDefined()
  })

  it("una celda lleva a la matriz filtrada por su clasificación, sin arrastrar los demás filtros", () => {
    show(ROWS, {}, 7, "buscar=lodo&factor=f1&controlado=no&tab=resumen")
    const celda = within(screen.getByRole("table", { name: /^Riesgo inherente/ })).getAllByRole("cell")[1]!
    const link = within(celda).getByRole("link")
    expect(link).toHaveAttribute("href", `${P}?clasificacion=important`)
    expect(link).toHaveAttribute("title", "Ver los 4 riesgos Importantes de la matriz")
  })

  it("sin residual registrado (producción hoy) lo explica con una salida, no una grilla en cero", () => {
    show()
    expect(screen.getByText("Aún no se registra el efecto de las medidas")).toBeDefined()
    expect(screen.queryByRole("table", { name: /^Riesgo residual/ })).toBeNull()
    const cta = screen.getByRole("link", { name: /Ver riesgos no controlados/ })
    expect(cta).toHaveAttribute("href", `${P}?controlado=no`)
  })

  it("sin riesgos no controlados el vacío residual no ofrece un enlace a una lista vacía", () => {
    show(ROWS, {}, 0)
    expect(screen.getByText("Aún no se registra el efecto de las medidas")).toBeDefined()
    expect(screen.queryByRole("link", { name: /no controlados/ })).toBeNull()
  })

  it("con residual registrado lo compara con el inherente y advierte la cobertura parcial", () => {
    show(ROWS, { e1: "low", e2: "low", e4: "medium", fuera: "critical" })
    const table = screen.getByRole("table", { name: /^Riesgo residual/ })
    expect(within(table).getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["Tolerable", "Moderado", "Importante", "Intolerable"])
    // El residual de otra MIPER («fuera») no se cuenta: 3 de los 7 de ésta.
    expect(screen.getByText("Residual registrado en 3 de 7 riesgos.")).toBeDefined()
    expect(screen.queryByText("Aún no se registra el efecto de las medidas")).toBeNull()
  })

  it("sin ningún riesgo evaluado no dibuja una grilla en cero: explica el vacío y ofrece ver los riesgos", () => {
    show([entry("a", null, null), entry("b", 4, null)])
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByText("Ningún riesgo está evaluado todavía")).toBeDefined()
    expect(screen.getByRole("link", { name: /Ver riesgos/ })).toHaveAttribute("href", P)
  })

  it("el título del gráfico es un encabezado de nivel 2 y los dos lados, de nivel 3", () => {
    show()
    expect(screen.getByRole("heading", { level: 2, name: "Dónde se concentra el riesgo" })).toBeDefined()
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Riesgo inherente", "Riesgo residual"])
  })
})

// @vitest-environment jsdom
import { RISK_BAND_FILL } from "@/components/charts/risk-bands"
import type { ReactNode } from "react"
import { describe, it, expect, vi } from "vitest"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { RiskMatrix, ResidualBands } from "@/components/charts/risk-matrix"
import { RiskShareBar, RiskShareLegend } from "@/components/charts/risk-share-bar"
import { buildRiskMatrix, summarizeResidual } from "@/lib/prevention/miper/risk-matrix"
import { RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: Record<string, unknown>) => <a href={String(href)} {...rest}>{children as ReactNode}</a>,
}))

const at = (probability: number | null, consequence: number | null, times = 1) =>
  Array.from({ length: times }, () => ({ probability, consequence }))

const CAPTION = "Riesgo inherente: cantidad de riesgos por probabilidad y consecuencia"
const MATRIX = buildRiskMatrix([...at(4, 2, 3), ...at(2, 4), ...at(1, 1, 2), ...at(null, 2, 2), ...at(4, null)])

describe("RiskMatrix — una tabla real, no un dibujo", () => {
  it("tiene nombre, encabezados de columna y de fila con scope y 9 celdas con su conteo en texto", () => {
    render(<RiskMatrix matrix={MATRIX} caption={CAPTION} />)
    const table = screen.getByRole("table", { name: CAPTION })
    const columns = within(table).getAllByRole("columnheader")
    expect(columns.every((header) => header.getAttribute("scope") === "col")).toBe(true)
    // La consecuencia sube hacia la derecha.
    expect(columns.slice(-3).map((header) => header.textContent)).toEqual([
      "Consecuencia Baja C1", "Consecuencia Media C2", "Consecuencia Alta C4",
    ])
    const rows = within(table).getAllByRole("rowheader")
    expect(rows.every((header) => header.getAttribute("scope") === "row")).toBe(true)
    // La probabilidad más alta arriba.
    expect(rows.map((header) => header.textContent)).toEqual(["Probabilidad Alta P4", "Probabilidad Media P2", "Probabilidad Baja P1"])
    const cells = within(table).getAllByRole("cell")
    expect(cells).toHaveLength(9)
    expect(cells[1]!.textContent).toBe("3 riesgos, Importante") // P4 × C2
    expect(cells[5]!.textContent).toBe("1 riesgo, Importante") // P2 × C4
    expect(cells[6]!.textContent).toBe("2 riesgos, Tolerable") // P1 × C1
    expect(cells[8]!.textContent).toBe("0 riesgos, Moderado") // P1 × C4
  })

  it("el color nunca es la única señal: cada celda imprime su clasificación, y las 4 aparecen", () => {
    render(<RiskMatrix matrix={buildRiskMatrix([])} caption={CAPTION} />)
    const text = within(screen.getByRole("table")).getAllByRole("cell").map((cell) => cell.textContent ?? "")
    for (const label of ["Tolerable", "Moderado", "Importante", "Intolerable"]) {
      expect(text.some((cell) => cell.endsWith(label))).toBe(true)
    }
    expect(text.every((cell) => /^0 riesgos, \S+/.test(cell))).toBe(true)
  })

  it("las abreviaturas P y C llevan su nombre completo en `title` (A6)", () => {
    render(<RiskMatrix matrix={MATRIX} caption={CAPTION} />)
    expect(screen.getAllByTitle("Probabilidad Alta (4)")).toHaveLength(1)
    expect(screen.getAllByTitle("Consecuencia Media (2)")).toHaveLength(1)
  })

  it("las entradas sin P o C se dicen fuera de la grilla, no como celda ni como cero", () => {
    render(<RiskMatrix matrix={MATRIX} caption={CAPTION} />)
    expect(screen.getByText(/3 riesgos sin evaluar/)).toBeDefined()
    expect(within(screen.getByRole("table")).getAllByRole("cell")).toHaveLength(9)
  })

  it("sin entradas sin evaluar no agrega la nota", () => {
    render(<RiskMatrix matrix={buildRiskMatrix(at(1, 1))} caption={CAPTION} />)
    expect(screen.queryByText(/sin evaluar/)).toBeNull()
  })

  it("con `hrefFor`, sólo las celdas con riesgos son enlaces y dicen a cuáles riesgos llevan: los de esa celda", () => {
    render(<RiskMatrix matrix={MATRIX} caption={CAPTION} hrefFor={(cell) => `/m?celda=P${cell.probability}xC${cell.consequence}`} />)
    const links = within(screen.getByRole("table")).getAllByRole("link")
    // Tres celdas pobladas: P4 × C2, P2 × C4 y P1 × C1.
    expect(links).toHaveLength(3)
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/m?celda=P4xC2", "/m?celda=P2xC4", "/m?celda=P1xC1"])
    // Las dos celdas de magnitud 8 ya no comparten destino ni cifra: cada título cuenta lo suyo.
    expect(links[0]!.getAttribute("title")).toBe("Ver los 3 riesgos de probabilidad Alta × consecuencia Media (P4 × C2)")
    expect(links[1]!.getAttribute("title")).toBe("Ver el riesgo de probabilidad Media × consecuencia Alta (P2 × C4)")
    expect(links[2]!.getAttribute("title")).toBe("Ver los 2 riesgos de probabilidad Baja × consecuencia Baja (P1 × C1)")
  })

  it("la celda vigente (`selected`) se marca con aria-current y su enlace dice que quita el filtro", () => {
    render(<RiskMatrix matrix={MATRIX} caption={CAPTION} selected={{ probability: 4, consequence: 2 }} hrefFor={(cell) => `/m?celda=P${cell.probability}xC${cell.consequence}`} />)
    const links = within(screen.getByRole("table")).getAllByRole("link")
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["true", null, null])
    expect(links[0]!.getAttribute("title")).toBe("Quitar el filtro de esta celda")
    expect(links[1]!.getAttribute("title")).toMatch(/^Ver el riesgo/)
  })

  it("sin `hrefFor` ninguna celda es enlace", () => {
    render(<RiskMatrix matrix={MATRIX} caption={CAPTION} />)
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })

  it("`renderLink` permite navegar sin ida al servidor (la MIPER usa `replaceState`)", () => {
    render(<RiskMatrix matrix={MATRIX} caption={CAPTION} hrefFor={() => "/x"}
      renderLink={({ href, children, ...rest }) => <a href={href} {...rest} data-custom="">{children}</a>} />)
    expect(within(screen.getByRole("table")).getAllByRole("link")[0]!.hasAttribute("data-custom")).toBe(true)
  })
})

/** Riesgos con su peligro: lo que `RiskConcentration` le pasa a `buildRiskMatrix` (las filas de la foto traen `hazard`). */
const hz = (probability: number, consequence: number, hazard: string | null, times = 1) =>
  Array.from({ length: times }, () => ({ probability, consequence, hazard }))
const WITH_HAZARDS = buildRiskMatrix([
  ...hz(4, 2, "Atrapamiento", 3), ...hz(4, 2, "Ruido", 2), ...hz(4, 2, "Caída de objetos", 1), ...hz(4, 2, "Polvo", 1),
  ...hz(1, 1, "Iluminación deficiente"),
  ...hz(2, 4, null),
])

describe("RiskMatrix — los 3 peligros más frecuentes de la celda (P-3)", () => {
  const cellLink = (name: RegExp) => within(screen.getByRole("table")).getAllByRole("link").find((link) => name.test(link.getAttribute("href") ?? ""))!
  const open = async (element: HTMLElement) => { await act(async () => { fireEvent.focus(element) }) }
  const hrefFor = (cell: { probability: number; consequence: number }) => `/m?celda=P${cell.probability}xC${cell.consequence}`

  it("al enfocar el enlace con el teclado aparece el tooltip con los 3 más frecuentes, con su cuenta, y se cierra al salir", async () => {
    render(<RiskMatrix matrix={WITH_HAZARDS} caption={CAPTION} hrefFor={hrefFor} />)
    const link = cellLink(/P4xC2/)
    expect(screen.queryByRole("tooltip")).toBeNull()
    await open(link)
    const tip = await screen.findByRole("tooltip")
    expect(tip.textContent).toContain("Peligros más frecuentes")
    expect(tip.textContent).toMatch(/Atrapamiento\D+3 riesgos/)
    expect(tip.textContent).toMatch(/Ruido\D+2 riesgos/)
    expect(tip.textContent).toMatch(/Caída de objetos\D+1 riesgo\b/)
    // «Polvo» es el cuarto y no cabe: se dice que hay más, no se calla.
    expect(tip.textContent).not.toContain("Polvo")
    expect(tip.textContent).toContain("y 1 peligro más")
    expect(tip.textContent).toContain("Clic para ver estos 7 riesgos")
    // El lector de pantalla lo recibe como descripción del enlace, no sólo como un cuadro que se ve.
    expect(link.getAttribute("aria-describedby")).toBe(tip.id)
    await act(async () => { fireEvent.blur(link) })
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("también se abre al pasar el puntero", async () => {
    render(<RiskMatrix matrix={WITH_HAZARDS} caption={CAPTION} hrefFor={hrefFor} />)
    await act(async () => { fireEvent.pointerMove(cellLink(/P1xC1/), { pointerType: "mouse" }) })
    expect((await screen.findByRole("tooltip", {}, { timeout: 1000 })).textContent).toContain("Iluminación deficiente")
  })

  it("con un solo peligro distinto no promete «más frecuentes» ni dice «y 0 más»", async () => {
    render(<RiskMatrix matrix={WITH_HAZARDS} caption={CAPTION} hrefFor={hrefFor} />)
    await open(cellLink(/P1xC1/))
    const tip = await screen.findByRole("tooltip")
    expect(tip.textContent).toContain("Peligro más frecuente")
    expect(tip.textContent).not.toContain("Peligros más frecuentes")
    expect(tip.textContent).not.toMatch(/\d+ peligros? más/)
    expect(tip.textContent).toContain("Clic para ver este riesgo")
  })

  it("con tooltip el título nativo se retira (no se duplican); sin peligros escritos conserva el título", () => {
    render(<RiskMatrix matrix={WITH_HAZARDS} caption={CAPTION} hrefFor={hrefFor} />)
    expect(cellLink(/P4xC2/).hasAttribute("title")).toBe(false)
    // P2 × C4 tiene un riesgo sin peligro escrito: no hay qué mostrar, el enlace sigue diciendo a dónde lleva.
    expect(cellLink(/P2xC4/).getAttribute("title")).toBe("Ver el riesgo de probabilidad Media × consecuencia Alta (P2 × C4)")
  })

  it("la celda vigente dice en el tooltip que el clic quita el filtro", async () => {
    render(<RiskMatrix matrix={WITH_HAZARDS} caption={CAPTION} hrefFor={hrefFor} selected={{ probability: 4, consequence: 2 }} />)
    await open(cellLink(/P4xC2/))
    expect((await screen.findByRole("tooltip")).textContent).toContain("Clic para quitar el filtro")
  })

  it("sin enlace la celda con peligros igual se alcanza con el teclado", async () => {
    render(<RiskMatrix matrix={WITH_HAZARDS} caption={CAPTION} />)
    const cells = within(screen.getByRole("table")).getAllByRole("cell")
    const focusable = cells.filter((cell) => cell.querySelector("[tabindex='0']"))
    // Dos celdas con peligro escrito (P4 × C2 y P1 × C1); las vacías y la de un riesgo sin peligro no.
    expect(focusable).toHaveLength(2)
    await open(focusable[0]!.querySelector<HTMLElement>("[tabindex='0']")!)
    expect((await screen.findByRole("tooltip")).textContent).not.toContain("Clic para")
  })

  it("una celda vacía no tiene tooltip ni foco", () => {
    render(<RiskMatrix matrix={WITH_HAZARDS} caption={CAPTION} hrefFor={hrefFor} />)
    const empty = within(screen.getByRole("table")).getAllByRole("cell")[0]! // P4 × C1: sin riesgos
    expect(empty.querySelector("a, [tabindex]")).toBeNull()
  })
})

describe("ResidualBands — el efecto de las medidas, en las cuatro bandas", () => {
  it("compara el inherente y el residual por clasificación y dice cuántos riesgos tienen residual", () => {
    const inherent = buildRiskMatrix([...at(4, 4, 2), ...at(2, 4, 3), ...at(1, 1)])
    const residual = summarizeResidual(["a", "b", "c", "d", "e", "f"], { a: "high", b: "low", c: "low", d: "medium" })
    render(<ResidualBands caption="Riesgo residual por clasificación" inherent={inherent.byClassification} residual={residual} />)
    const table = screen.getByRole("table", { name: "Riesgo residual por clasificación" })
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["1", "2"], ["0", "1"], ["3", "1"], ["2", "0"],
    ])
    expect(within(table).getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["Tolerable", "Moderado", "Importante", "Intolerable"])
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Clasificación", "Inherente", "Residual"])
    expect(screen.getByText("Residual registrado en 4 de 6 riesgos.")).toBeDefined()
  })

  it("con todo registrado no agrega la advertencia de cobertura parcial", () => {
    const residual = summarizeResidual(["a"], { a: "low" })
    render(<ResidualBands caption="r" inherent={buildRiskMatrix(at(1, 1)).byClassification} residual={residual} />)
    expect(screen.queryByText(/Residual registrado en/)).toBeNull()
  })
})

describe("RiskShareBar — barra apilada de las cuatro clasificaciones", () => {
  const COUNTS = { tolerable: 4, moderate: 3, important: 2, intolerable: 1 }

  it("dibuja un tramo por clasificación con riesgos, proporcional a su cuenta y con token (sin hex)", () => {
    const { container } = render(<RiskShareBar label="Faena A" counts={{ ...COUNTS, moderate: 0 }} />)
    const segments = container.querySelectorAll<HTMLElement>("[data-band]")
    expect([...segments].map((segment) => segment.dataset.band)).toEqual(["tolerable", "important", "intolerable"])
    expect([...segments].map((segment) => segment.style.flexGrow)).toEqual(["4", "2", "1"])
    // jsdom descarta `color-mix` del estilo en línea: el token se valida en la tabla.
    for (const fill of Object.values(RISK_BAND_FILL)) {
      expect(fill).toMatch(/var\(--color-/)
      expect(fill).not.toMatch(/#[0-9a-f]{3,8}/i)
    }
  })

  it("el conteo de las cuatro va en texto, con el rótulo para el lector de pantalla", () => {
    render(<RiskShareBar label="Faena A" counts={COUNTS} />)
    const list = screen.getByRole("list", { name: "Faena A: riesgos por clasificación" })
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Tolerable: 4", "Moderado: 3", "Importante: 2", "Intolerable: 1",
    ])
  })

  it("la barra es decorativa para el lector de pantalla: la lista ya lo dice", () => {
    const { container } = render(<RiskShareBar label="Faena A" counts={COUNTS} />)
    expect(container.querySelector("[data-band]")!.closest("[aria-hidden='true']")).not.toBeNull()
  })

  it("sin riesgos evaluados no dibuja una barra vacía: lo explica", () => {
    const { container } = render(<RiskShareBar label="Faena B" counts={{ tolerable: 0, moderate: 0, important: 0, intolerable: 0 }} />)
    expect(container.querySelector("[data-band]")).toBeNull()
    expect(screen.getByText("Sin riesgos evaluados")).toBeDefined()
  })

  it("la leyenda nombra las cuatro clasificaciones, en orden creciente", () => {
    render(<RiskShareLegend />)
    expect(within(screen.getByRole("list", { name: "Clasificación del riesgo" })).getAllByRole("listitem").map((item) => item.textContent))
      .toEqual(RISK_CLASSIFICATIONS.map((value) => ({ tolerable: "Tolerable", moderate: "Moderado", important: "Importante", intolerable: "Intolerable" })[value]))
  })
})

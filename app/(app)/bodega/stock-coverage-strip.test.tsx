// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { summarizeCoverage, type CoverageBand } from "@/lib/bodega/stock-coverage"
import { StockCoverageStrip } from "./stock-coverage-strip"

afterEach(cleanup)

const hrefFor = (band: CoverageBand | "") => (band ? `/bodega?faena=ws-1&cobertura=${band}` : "/bodega?faena=ws-1")
const summary = summarizeCoverage(["lt7", "lt7", "d7_30", "gt30", "gt30", "gt30", "none", "insufficient"])

describe("StockCoverageStrip", () => {
  it("responde antes del dibujo y reparte las líneas en las cinco bandas, con su cifra", () => {
    render(<StockCoverageStrip summary={summary} noun="producto" active="" hrefFor={hrefFor} />)

    expect(screen.getByRole("heading", { name: "Cobertura del stock" })).toBeTruthy()
    expect(screen.getByText(/2 de 8 productos alcanzan para menos de 7 días/)).toBeTruthy()
    const legend = screen.getByRole("list")
    for (const label of ["Menos de 7 días", "7 a 30 días", "Más de 30 días", "Datos insuficientes", "Sin consumo"]) {
      expect(legend.textContent).toContain(label)
    }
  })

  it("cada banda filtra la tabla: el enlace conserva los demás filtros y deja `cobertura`", () => {
    render(<StockCoverageStrip summary={summary} noun="producto" active="" hrefFor={hrefFor} />)
    const link = screen.getByRole("link", { name: /Menos de 7 días/ })
    expect(link.getAttribute("href")).toBe("/bodega?faena=ws-1&cobertura=lt7")
  })

  it("con una banda elegida se marca, elegirla otra vez la quita y hay una salida explícita", () => {
    render(<StockCoverageStrip summary={summary} noun="producto" active="lt7" hrefFor={hrefFor} />)
    const active = screen.getByRole("link", { name: /Menos de 7 días/ })
    expect(active.getAttribute("aria-current")).toBe("true")
    expect(active.getAttribute("href")).toBe("/bodega?faena=ws-1")
    expect(screen.getByRole("link", { name: "Quitar filtro" }).getAttribute("href")).toBe("/bodega?faena=ws-1")
  })

  it("«Ver datos» explica cada banda, también las que no dan cifra", () => {
    render(<StockCoverageStrip summary={summary} noun="producto" active="" hrefFor={hrefFor} />)
    expect(screen.getByText(/menos de 3 en 90 días o el producto lleva menos de 30 días/)).toBeTruthy()
  })

  it("sin ninguna línea no dibuja nada: la tabla ya explica su vacío", () => {
    const { container } = render(<StockCoverageStrip summary={summarizeCoverage([])} noun="producto" active="" hrefFor={hrefFor} />)
    expect(container.firstChild).toBeNull()
  })
})

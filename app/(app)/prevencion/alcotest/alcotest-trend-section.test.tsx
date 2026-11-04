// @vitest-environment jsdom

/**
 * CHART-010 (alcotest): sólo conteos agregados. Ni el gráfico ni «Ver datos» pueden
 * nombrar a nadie, y sin controles no se dibuja nada.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { AlcotestTrendSection } from "./alcotest-trend-section"
import { shapeAlcotestTrend } from "@/lib/prevention/alcotest-trend"

describe("AlcotestTrendSection", () => {
  it("dice cuántos controles hubo y cuántos dieron positivo, con la base a la vista", () => {
    const points = shapeAlcotestTrend([{ month: "2026-09", total: 40, positives: 1 }], "2026-10-05")
    const { container } = render(<AlcotestTrendSection points={points} />)
    expect(screen.getByRole("heading", { name: "Controles por mes" })).toBeDefined()
    expect(screen.getByText("1 de 40 controles en septiembre resultó positivo.")).toBeDefined()
    expect(container.querySelector('[data-chart-kind="monthly-trend"]')).not.toBeNull()
    // La tabla de datos es agregada: encabezados de conteo, ninguna columna de personas.
    expect(screen.getAllByText("Negativos").length).toBeGreaterThan(0)
    expect(screen.queryByText(/Persona|Nombre|Trabajador/)).toBeNull()
  })

  it("sin ningún control no dibuja nada: «Controles recientes» ya explica el vacío", () => {
    const { container } = render(<AlcotestTrendSection points={[]} />)
    expect(container.firstChild).toBeNull()
    const onlyEmptyMonths = shapeAlcotestTrend([], "2026-10-05")
    expect(render(<AlcotestTrendSection points={onlyEmptyMonths} />).container.firstChild).toBeNull()
  })
})

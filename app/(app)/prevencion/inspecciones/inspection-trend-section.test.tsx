// @vitest-environment jsdom

/**
 * CHART-010 (inspecciones): la frase responde sola y el gráfico espera plegado; sin
 * inspecciones ejecutadas no se dibuja nada. Debajo del cumplimiento, los hallazgos
 * que siguen abiertos apilados por gravedad (P-4), en su propio gráfico y con su
 * propia escala.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { InspectionTrendSection } from "./inspection-trend-section"
import { shapeInspectionTrend } from "@/lib/prevention/inspection-trend"

const row = (month: string, over: Partial<Parameters<typeof shapeInspectionTrend>[0][number]> = {}) => ({
  month, runs: 2, scoredRuns: 2, scoredItems: 40, weightedPoints: 40 * 80, openCritical: 0, openHigh: 0, openMedium: 0, openLow: 0, ...over,
})

describe("InspectionTrendSection", () => {
  it("el título y la frase de cumplimiento se leen sin abrir el gráfico", () => {
    const points = shapeInspectionTrend([row("2026-08"), row("2026-09", { weightedPoints: 40 * 90 })], "2026-10-05")
    const { container } = render(<InspectionTrendSection points={points} />)

    const details = container.querySelector("details")!
    expect(details.open).toBe(false)
    const heading = screen.getByRole("heading", { name: "Cumplimiento y hallazgos por mes" })
    expect(details.contains(heading)).toBe(false)
    const sentence = screen.getByText(/Cumplimiento ponderado por ítems de 85% entre agosto y septiembre/)
    expect(details.contains(sentence)).toBe(false)
    expect(sentence.textContent).toContain("En septiembre fue de 90%, 10 puntos sobre agosto.")
    expect(container.querySelector('[data-chart-kind="monthly-trend"]')).not.toBeNull()
  })

  it("los hallazgos abiertos se apilan por gravedad en su propio gráfico, y quedan también en «Ver datos»", () => {
    const points = shapeInspectionTrend([row("2026-09", { openCritical: 1, openHigh: 1, openMedium: 2, openLow: 3 })], "2026-10-05")
    const { container } = render(<InspectionTrendSection points={points} />)

    // Dos gráficos de serie mensual: inspecciones + cumplimiento, y hallazgos por gravedad. Misma escala no tienen, por eso no comparten eje.
    expect(container.querySelectorAll('[data-chart-kind="monthly-trend"]')).toHaveLength(2)
    expect(screen.getByRole("heading", { level: 3, name: "Hallazgos que siguen abiertos" })).toBeDefined()
    expect(screen.getByText(/7 hallazgos siguen abiertos de las inspecciones entre septiembre y octubre; 2 son de gravedad alta o crítica\./)).toBeDefined()
    // La pila, de la más grave a la menos, nombrada en la leyenda (el color no es la única señal).
    const legend = screen.getByRole("group", { name: /hallazgos abiertos por gravedad/i })
    expect(legend.textContent).toMatch(/Gravedad crítica.*Gravedad alta.*Gravedad media.*Gravedad baja/)
    // Y en cifras, por gravedad.
    for (const header of ["Hallazgos abiertos", "De gravedad crítica", "De gravedad alta", "De gravedad media", "De gravedad baja"]) {
      expect(screen.getByText(header)).toBeDefined()
    }
  })

  it("sin hallazgos abiertos no dibuja una pila de ceros: lo dice", () => {
    const points = shapeInspectionTrend([row("2026-09")], "2026-10-05")
    const { container } = render(<InspectionTrendSection points={points} />)
    expect(container.querySelectorAll('[data-chart-kind="monthly-trend"]')).toHaveLength(1)
    expect(screen.getByText("Ningún hallazgo de las inspecciones de este período sigue abierto.")).toBeDefined()
  })

  it("las inspecciones del mes siguen a la vista: son las columnas del gráfico de cumplimiento", () => {
    const points = shapeInspectionTrend([row("2026-09", { runs: 5, openLow: 1 })], "2026-10-05")
    render(<InspectionTrendSection points={points} />)
    expect(screen.getByText("Inspecciones realizadas")).toBeDefined()
  })

  it("sin inspecciones ejecutadas no dibuja nada", () => {
    const { container } = render(<InspectionTrendSection points={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

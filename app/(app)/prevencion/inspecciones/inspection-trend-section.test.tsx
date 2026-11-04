// @vitest-environment jsdom

/**
 * CHART-010 (inspecciones): la frase responde sola y el gráfico espera plegado; sin
 * inspecciones ejecutadas no se dibuja nada.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { InspectionTrendSection } from "./inspection-trend-section"
import { shapeInspectionTrend } from "@/lib/prevention/inspection-trend"

const row = (month: string, over: Partial<Parameters<typeof shapeInspectionTrend>[0][number]> = {}) => ({
  month, runs: 2, scoredRuns: 2, scoredItems: 40, weightedPoints: 40 * 80, openFindings: 0, criticalOpenFindings: 0, ...over,
})

describe("InspectionTrendSection", () => {
  it("el título y la frase de cumplimiento se leen sin abrir el gráfico", () => {
    const points = shapeInspectionTrend([row("2026-08"), row("2026-09", { weightedPoints: 40 * 90 })], "2026-10-05")
    const { container } = render(<InspectionTrendSection points={points} />)

    const details = container.querySelector("details")!
    expect(details.open).toBe(false)
    const heading = screen.getByRole("heading", { name: "Cumplimiento por mes" })
    expect(details.contains(heading)).toBe(false)
    const sentence = screen.getByText(/Cumplimiento ponderado por ítems de 85% entre agosto y septiembre/)
    expect(details.contains(sentence)).toBe(false)
    expect(sentence.textContent).toContain("En septiembre fue de 90%, 10 puntos sobre agosto.")
    expect(container.querySelector('[data-chart-kind="monthly-trend"]')).not.toBeNull()
  })

  it("los hallazgos abiertos no se dibujan pero quedan en «Ver datos»", () => {
    const points = shapeInspectionTrend([row("2026-09", { openFindings: 3, criticalOpenFindings: 1 })], "2026-10-05")
    render(<InspectionTrendSection points={points} />)
    expect(screen.getByText("Hallazgos abiertos")).toBeDefined()
    expect(screen.getByText("De ellos, altos o críticos")).toBeDefined()
  })

  it("sin inspecciones ejecutadas no dibuja nada", () => {
    const { container } = render(<InspectionTrendSection points={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

// @vitest-environment jsdom

/**
 * `MonthlyTrendChart` (CHART-010 y CHART-011): columnas apiladas más una línea de
 * porcentaje opcional en eje propio. jsdom no mide, así que acá se comprueba lo
 * que el componente decide —qué dibuja, cómo se nombra, qué leyenda lleva—, no los
 * píxeles.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { MonthlyTrendChart, type MonthlyTrendPoint } from "@/components/charts/monthly-trend-chart"

const data: MonthlyTrendPoint[] = [
  { month: "2026-08", values: { runs: 4 }, rate: 80, note: "4 inspecciones" },
  { month: "2026-09", values: { runs: 0 }, rate: null, note: "Sin inspecciones realizadas en el mes" },
  { month: "2026-10", partial: true, values: { runs: 2 }, rate: 90 },
]

describe("MonthlyTrendChart", () => {
  it("dibuja el trazado con su nombre accesible y una leyenda por serie", () => {
    const { container } = render(
      <MonthlyTrendChart
        data={data}
        bars={[{ key: "runs", label: "Inspecciones realizadas", color: "var(--color-chart-reference)" }]}
        line={{ label: "Cumplimiento ponderado", color: "var(--color-primary)" }}
        ariaLabel="Inspecciones y cumplimiento por mes"
      />,
    )

    expect(container.querySelector('[data-chart-kind="monthly-trend"]')).not.toBeNull()
    const legend = screen.getByRole("group", { name: "Series de inspecciones y cumplimiento por mes" })
    expect(legend.textContent).toContain("Inspecciones realizadas")
    expect(legend.textContent).toContain("Cumplimiento ponderado")
  })

  it("sin línea, la leyenda lista sólo las columnas (alcotest: negativos y positivos)", () => {
    render(
      <MonthlyTrendChart
        data={[{ month: "2026-10", values: { negatives: 9, positives: 1 } }]}
        bars={[
          { key: "negatives", label: "Negativos", color: "var(--color-primary)" },
          { key: "positives", label: "Positivos", color: "var(--color-danger)" },
        ]}
        ariaLabel="Controles de alcotest por mes"
      />,
    )
    const legend = screen.getByRole("group", { name: "Series de controles de alcotest por mes" })
    expect(legend.textContent).toContain("Negativos")
    expect(legend.textContent).toContain("Positivos")
    expect(legend.textContent).not.toContain("Cumplimiento")
  })

  it("sin ningún mes no dibuja una rejilla vacía", () => {
    const { container } = render(
      <MonthlyTrendChart data={[]} bars={[{ key: "runs", label: "Inspecciones", color: "var(--color-primary)" }]} ariaLabel="Vacío" />,
    )
    expect(container.firstChild).toBeNull()
  })
})

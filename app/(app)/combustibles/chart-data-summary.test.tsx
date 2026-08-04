// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ChartDataSummary } from "./chart-data-summary"

describe("ChartDataSummary", () => {
  it("explains the empty chart state in text and preserves an equivalent table", () => {
    render(
      <ChartDataSummary
        title="Productos"
        data={[]}
        periodLabel="todos los registros"
        groupLabel="Productos"
        visibleLimit={8}
      />,
    )

    expect(screen.getByText("No hay datos de productos para los filtros aplicados.")).toBeInTheDocument()
    expect(screen.getByRole("table")).toHaveTextContent("Sin datos para los filtros aplicados.")
  })

  it("makes the single point state explicit", () => {
    render(
      <ChartDataSummary
        title="Evolución mensual"
        data={[{ group: "2026-08", totalAmount: 120_000, totalLiters: 80, count: 1 }]}
        periodLabel="2026-08"
        groupLabel="Meses"
      />,
    )

    expect(screen.getByText(/Hay un único dato: 2026-08 registra/)).toBeInTheDocument()
    expect(screen.getByRole("table")).toHaveTextContent("2026-08")
  })

  it("uses the same eight rows as a truncated category chart", () => {
    const data = Array.from({ length: 9 }, (_, index) => ({
      group: `Producto ${index + 1}`,
      totalAmount: (9 - index) * 10_000,
      totalLiters: 100 - index,
    }))

    render(
      <ChartDataSummary
        title="Productos"
        data={data}
        periodLabel="todos los registros"
        groupLabel="Productos"
        visibleLimit={8}
      />,
    )

    expect(screen.getByText("Tabla equivalente: 8 productos visibles de 9.")).toBeInTheDocument()
    const table = screen.getByRole("table")
    expect(within(table).getByText("Producto 1")).toBeInTheDocument()
    expect(within(table).queryByText("Producto 9")).not.toBeInTheDocument()
  })
})

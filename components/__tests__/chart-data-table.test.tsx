// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ChartDataTable, type ChartDataTableRow } from "@/components/ui/chart-data-table"

afterEach(() => cleanup())

/**
 * Fixtures de 0, 1 y muchos puntos (TASK-UI-015).
 *
 * El criterio los pide explícitamente: *"estados que deben diseñarse: sin
 * datos, un punto, carga, error"*. Un gráfico con un solo punto no es un caso
 * degenerado que se pueda dejar al azar — es el estado de una faena que acaba
 * de empezar a operar, y el que más veces ve un usuario nuevo.
 *
 * Se prueba sobre `ChartDataTable` y no sobre las once superficies: es el punto
 * único por el que pasan las tres ramas, y probarlo once veces con datos
 * distintos comprobaría lo mismo once veces.
 */
function tabla(rows: ChartDataTableRow[], conclusion: string) {
  return (
    <ChartDataTable
      title="Gasto mensual"
      groupLabel="Mes"
      columns={["Total"]}
      rows={rows}
      conclusion={conclusion}
      caption="Montos en pesos chilenos."
    />
  )
}

describe("lectura equivalente — 0, 1 y muchos puntos", () => {
  it("sin datos: lo dice y no finge una tabla vacía navegable", () => {
    render(tabla([], "No hay gasto en el período."))
    expect(screen.getByText("Tabla equivalente: sin datos")).toBeInTheDocument()
    expect(screen.getByText("No hay gasto en el período.")).toBeInTheDocument()
    expect(screen.getByText("Sin datos para los filtros aplicados.")).toBeInTheDocument()
  })

  it("un punto: concuerda el singular en vez de decir '1 filas'", () => {
    render(tabla([{ label: "agosto", values: ["$1.000"] }], "Único mes con gasto: agosto."))
    expect(screen.getByText("Tabla equivalente: 1 fila")).toBeInTheDocument()
    expect(screen.getByText("$1.000")).toBeInTheDocument()
  })

  it("muchos puntos: cuenta las filas y las muestra todas", () => {
    const rows = ["junio", "julio", "agosto"].map((label, i) => ({ label, values: [`$${i + 1}.000`] }))
    render(tabla(rows, "El mes de mayor gasto es agosto."))
    expect(screen.getByText("Tabla equivalente: 3 filas")).toBeInTheDocument()
    for (const { label } of rows) expect(screen.getByText(label)).toBeInTheDocument()
  })

  it("la conclusión va antes que el gráfico y se anuncia como resumen", () => {
    render(tabla([{ label: "agosto", values: ["$1.000"] }], "Único mes con gasto: agosto."))
    // El criterio dice "conclusión antes del gráfico": el resumen es una región
    // nombrada, no un pie de tabla que haya que ir a buscar.
    expect(screen.getByRole("region", { name: "Resumen de Gasto mensual" })).toBeInTheDocument()
    expect(screen.getByText("Lectura rápida.")).toBeInTheDocument()
  })

  it("la tabla se despliega con teclado: es un details, no un div con onClick", () => {
    render(tabla([{ label: "agosto", values: ["$1.000"] }], "Único mes."))
    const resumen = screen.getByText("Tabla equivalente: 1 fila")
    expect(resumen.tagName).toBe("SUMMARY")
  })
})

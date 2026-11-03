// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import type { FuelCoverageMatrix } from "@/lib/combustibles/coverage-matrix-data"
import { CoverageMap } from "./coverage-map"

const matrix: FuelCoverageMatrix = {
  months: ["2026-08", "2026-09", "2026-10", "2026-11"],
  rows: [
    { id: "copec-tarjeta", label: "Copec: tarjeta de equipos", cells: [
      { status: "ok", detail: "128 filas, 19.040 L" },
      { status: "missing", detail: "sin datos del proveedor" },
      { status: "partial", detail: "90 filas, 12.000 L, sin cerrar" },
      { status: "upcoming", detail: "14 filas, 2.100 L hasta ahora" },
    ] },
    { id: "onway", label: "GPS OnWay", cells: [
      { status: "na" }, { status: "na" }, { status: "ok", detail: "31 de 31 días con sincronización" }, { status: "missing", detail: "0 de 2 días con sincronización, hasta ayer" },
    ] },
  ],
}

describe("CoverageMap (CHART-022)", () => {
  it("es una figura con la frase que responde, una tabla fuente × mes y el estado en palabras de datos", () => {
    render(<CoverageMap matrix={matrix} />)
    const figure = screen.getByRole("figure", { name: "Cobertura de datos por mes" })
    expect(within(figure).getByText("Hay huecos en 2 de 2 fuentes: Copec: tarjeta de equipos (sep 2026 y oct 2026) y GPS OnWay (nov 2026).")).toBeDefined()
    const table = within(figure).getByRole("table", { name: "Cobertura de datos por fuente en los últimos 12 meses" })
    expect(within(table).getByRole("rowheader", { name: "Copec: tarjeta de equipos" })).toBeDefined()
    expect(within(table).getByRole("columnheader", { name: "Sep" })).toBeDefined()
    expect(within(table).getByText("Completo, 128 filas, 19.040 L")).toBeDefined()
    expect(within(table).getByText("Sin datos, sin datos del proveedor")).toBeDefined()
    expect(within(table).getByText("Parcial, 90 filas, 12.000 L, sin cerrar")).toBeDefined()
    expect(within(table).getByText("En curso, 14 filas, 2.100 L hasta ahora")).toBeDefined()
    expect(within(table).getByText("Sin datos, 0 de 2 días con sincronización, hasta ayer")).toBeDefined()
    // Vocabulario de cobertura, no de cumplimiento.
    expect(within(figure).queryByText(/Vencido|Cumplido/)).toBeNull()
  })

  it("lleva a la lista de archivos importados y no promete un enlace por celda", () => {
    render(<CoverageMap matrix={matrix} />)
    expect(screen.getByRole("link", { name: /Ver archivos importados/ }).getAttribute("href")).toBe("/combustibles/fuentes/archivos")
    expect(screen.getAllByRole("link")).toHaveLength(1)
  })

  it("sin ninguna fuente que mostrar no dibuja nada", () => {
    const { container } = render(<CoverageMap matrix={{ months: matrix.months, rows: [] }} />)
    expect(container.innerHTML).toBe("")
  })
})

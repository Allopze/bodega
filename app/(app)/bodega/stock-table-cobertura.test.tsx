// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { computeCoverage } from "@/lib/bodega/stock-coverage"

vi.mock("./stock-export-button", () => ({ StockExportButton: () => null }))

import { StockTable } from "./stock-table"
import type { WorksiteStockWithProduct } from "./types"

function line(id: string, quantity: number, coverage?: WorksiteStockWithProduct["coverage"]): WorksiteStockWithProduct {
  return {
    id, worksiteId: "ws-1", productId: id, quantity, incoming: 0, hasStockRecord: true,
    lastMovementAt: null, updatedAt: "2026-08-10T00:00:00.000Z", coverage,
    product: { name: `Producto ${id}`, sku: null, unitOfMeasure: "unidad" }, worksite: null,
  }
}

const steady = { events: 12, historyDays: 200 }
const worksites = (items: WorksiteStockWithProduct[]) => [{ id: "ws-1", name: "Cholguán", items }]

function renderTable(items: WorksiteStockWithProduct[]) {
  render(<StockTable worksites={worksites(items)} />)
  return within(screen.getByRole("table"))
}

/** Texto de la columna «Cobertura» por fila, en el orden en pantalla. */
function coverageColumn(table: ReturnType<typeof within>) {
  const headers = (table.getAllByRole("columnheader") as HTMLElement[]).map((header: HTMLElement) => header.textContent ?? "")
  const column = headers.findIndex((header: string) => header.includes("Cobertura"))
  return (table.getAllByRole("row") as HTMLElement[])
    .filter((row) => within(row).queryAllByRole("cell").length > 0)
    .map((row) => within(row).getAllByRole("cell")[column]!.textContent)
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe("StockTable · columna Cobertura", () => {
  const urgent = computeCoverage({ quantity: 5, consumed: 90, ...steady })
  const comfortable = computeCoverage({ quantity: 90, consumed: 90, ...steady })
  const idle = computeCoverage({ quantity: 40, consumed: 0, events: 0, historyDays: 200 })
  const thin = computeCoverage({ quantity: 40, consumed: 4, events: 2, historyDays: 200 })

  it("aparece con la cifra en texto y el estado dicho con palabras, no sólo con color", () => {
    const table = renderTable([line("a", 5, urgent), line("b", 90, comfortable), line("c", 40, idle), line("d", 40, thin)])
    expect(table.getByRole("columnheader", { name: /Cobertura/ })).toBeTruthy()
    expect(coverageColumn(table)).toEqual(["5 d", "90 d", "Sin consumo", "Datos insuficientes"])
  })

  it("sin cobertura calculada la tabla es la de siempre: no hay columna", () => {
    const table = renderTable([line("a", 5), line("b", 7)])
    expect(table.queryByRole("columnheader", { name: /Cobertura/ })).toBeNull()
  })

  it("«Datos insuficientes» muestra su n en el tooltip, para que la cifra ausente se explique", () => {
    renderTable([line("d", 40, thin)])
    expect(screen.getAllByTitle(/2 salidas en los últimos 90 días/).length).toBeGreaterThan(0)
  })

  it("ordenar por cobertura pone primero lo que se agota antes y deja al final lo que no tiene cifra", () => {
    const table = renderTable([line("c", 40, idle), line("b", 90, comfortable), line("a", 5, urgent)])
    fireEvent.click(table.getByRole("button", { name: /Cobertura/ }))
    // Primer clic en una columna numérica ordena de mayor a menor; el segundo, de menor a mayor.
    fireEvent.click(table.getByRole("button", { name: /Cobertura/ }))
    expect(coverageColumn(table)).toEqual(["5 d", "90 d", "Sin consumo"])
    fireEvent.click(table.getByRole("button", { name: /Cobertura/ }))
    expect(coverageColumn(table)).toEqual(["90 d", "5 d", "Sin consumo"])
  })
})

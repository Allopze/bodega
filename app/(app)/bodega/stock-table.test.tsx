// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { formatDate } from "@/lib/utils"

vi.mock("./actions", () => ({ setMinStockAction: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("./stock-export-button", () => ({ StockExportButton: () => null }))

import { StockTable } from "./stock-table"
import { WarehouseHeaderMetrics } from "./bodega-header-metrics"
import type { WorksiteStockWithProduct } from "./types"

function line(overrides: Partial<WorksiteStockWithProduct> & { id: string }): WorksiteStockWithProduct {
  return {
    worksiteId: "ws-1",
    productId: "p-1",
    quantity: 0,
    minStock: 0,
    lastMovementAt: null,
    updatedAt: "2026-08-10T00:00:00.000Z",
    product: { name: "Buzo Dupont Tyvek", sku: "EPP-TRECK-008", unitOfMeasure: "unidad" },
    worksite: null,
    ...overrides,
  }
}

const WORKSITES = [
  { id: "ws-1", name: "Biodiversa", items: [line({ id: "s-1", quantity: 200, lastMovementAt: new Date().toISOString() })] },
  { id: "ws-2", name: "Masisa", items: [line({ id: "s-2", worksiteId: "ws-2", quantity: 4 })] },
]

/** jsdom no aplica media queries: el bloque de tarjetas móvil y la tabla de
 *  escritorio se montan a la vez. Todas las aserciones van dentro de la tabla. */
function renderTable(worksites = WORKSITES) {
  render(<StockTable worksites={worksites} />)
  return within(screen.getByRole("table"))
}

/** Celdas de datos, en orden, de las filas que no son encabezado de grupo. */
function cells(table: ReturnType<typeof within>, column: number) {
  return (table.getAllByRole("row") as HTMLElement[])
    .filter((row: HTMLElement) => within(row).queryAllByRole("cell").length > 0)
    .map((row: HTMLElement) => within(row).getAllByRole("cell")[column]!.textContent)
}

afterEach(() => {
  sessionStorage.clear()
})

describe("StockTable", () => {
  it("etiqueta todas las columnas: sin <thead> nadie sabe qué es la fecha ni el mínimo", () => {
    const table = renderTable()

    for (const label of ["Producto", "Estado", "Stock actual", "Mínimo", "Último movimiento"]) {
      expect(table.getByRole("columnheader", { name: label })).toBeTruthy()
    }
  })

  it("usa una sola tabla para todas las faenas, para que las cantidades alineen entre grupos", () => {
    const table = renderTable()

    expect(screen.getAllByRole("table")).toHaveLength(1)
    expect(table.getByRole("rowheader", { name: /Biodiversa/ })).toBeTruthy()
    expect(table.getByRole("rowheader", { name: /Masisa/ })).toBeTruthy()
  })

  it("deja la columna de cantidad con dígitos puros y manda la unidad junto al SKU", () => {
    const table = renderTable()

    expect(cells(table, 2)).toEqual(["200", "4"])
    expect(table.getAllByText("EPP-TRECK-008 · unidad")).toHaveLength(2)
  })

  it("ofrece definir el mínimo en vez de mostrar un guion muerto", () => {
    const table = renderTable()

    expect(table.getAllByRole("button", { name: /definir stock mínimo/i })).toHaveLength(2)
  })

  it("dice el estado con palabras y no sólo con un punto de color", () => {
    const table = renderTable([
      { id: "ws-1", name: "Biodiversa", items: [line({ id: "s-1", quantity: 1, minStock: 5 })] },
      { id: "ws-2", name: "Masisa", items: [line({ id: "s-2", worksiteId: "ws-2", quantity: 4 })] },
    ])

    expect(cells(table, 1)).toEqual(["Bajo mínimo", "Sin mínimo"])
  })

  it("acompaña la fecha del último movimiento con su distancia en días", () => {
    const table = renderTable()

    expect(cells(table, 4)).toEqual([`${formatDate(WORKSITES[0]!.items[0]!.lastMovementAt!)}hoy`, "—"])
  })

  it("agrupa por producto con el total sumado, que es lo que no se podía leer por faena", () => {
    const table = renderTable()
    fireEvent.click(screen.getByRole("button", { name: "Por producto" }))

    const regrouped = within(screen.getByRole("table"))
    expect(regrouped.getByRole("rowheader", { name: /Buzo Dupont Tyvek.*204 unidades en 2 faenas/ })).toBeTruthy()
    // Las faenas pasan a ser filas del producto, no encabezados de grupo.
    expect(cells(regrouped, 0)).toEqual(["Biodiversa", "Masisa"])
    expect(table.queryByRole("rowheader", { name: /Biodiversa/ })).toBeNull()
  })

  it("conserva la agrupación elegida entre montajes: un refresco desmonta el árbol", () => {
    renderTable()
    fireEvent.click(screen.getByRole("button", { name: "Por producto" }))
    cleanup()

    renderTable()
    expect(screen.getByRole("button", { name: "Por producto" })).toHaveAttribute("aria-pressed", "true")
  })
})

describe("WarehouseHeaderMetrics", () => {
  const base = { worksiteCount: 7, worksitesWithStock: 5, productsWithStock: 6, movementCount: 13 }

  it("no reporta 0 bajo mínimo cuando nadie definió umbrales", () => {
    render(<WarehouseHeaderMetrics {...base} lowStockCount={0} minStockDefinedCount={0} />)

    expect(screen.getByText("sin mínimos definidos")).toBeTruthy()
    expect(screen.queryByText("0")).toBeNull()
  })

  it("reporta el conteo real cuando existen mínimos", () => {
    render(<WarehouseHeaderMetrics {...base} lowStockCount={2} minStockDefinedCount={9} />)

    expect(screen.getByText("2")).toBeTruthy()
    expect(screen.queryByText("sin mínimos definidos")).toBeNull()
  })
})

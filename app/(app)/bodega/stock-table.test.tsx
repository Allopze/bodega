// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { formatDate } from "@/lib/utils"

vi.mock("./stock-export-button", () => ({ StockExportButton: () => null }))

import { StockTable } from "./stock-table"
import { WarehouseHeaderMetrics } from "./bodega-header-metrics"
import type { WorksiteStockWithProduct } from "./types"

function line(overrides: Partial<WorksiteStockWithProduct> & { id: string }): WorksiteStockWithProduct {
  return {
    worksiteId: "ws-1",
    productId: "p-1",
    quantity: 0,
    lastMovementAt: null,
    updatedAt: "2026-08-10T00:00:00.000Z",
    product: { name: "Buzo Dupont Tyvek", sku: "EPP-TRECK-008", unitOfMeasure: "unidad" },
    worksite: null,
    incoming: 0,
    hasStockRecord: true,
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
  it("etiqueta todas las columnas: sin <thead> nadie sabe qué es la fecha", () => {
    const table = renderTable()

    for (const label of ["Producto", "En bodega", "Por recibir", "Último movimiento"]) {
      expect(table.getByRole("columnheader", { name: label })).toBeTruthy()
    }
  })

  it("ya no tiene stock mínimo ni estado: se retiraron el 2026-10-02", () => {
    const table = renderTable()

    for (const label of ["Estado", "Mínimo"]) {
      expect(table.queryByRole("columnheader", { name: label })).toBeNull()
    }
    expect(screen.queryByText(/mínimo/i)).toBeNull()
    expect(screen.queryByRole("link", { name: "Reponer" })).toBeNull()
  })

  it("se queda con lo que hay y lo que viene: sin demanda, entrada esperada ni saldo proyectado", () => {
    const table = renderTable()

    for (const label of ["Físico", "Demanda pendiente", "Entrada esperada", "Saldo proyectado"]) {
      expect(table.queryByRole("columnheader", { name: label })).toBeNull()
    }
  })

  it("explica Por recibir desde su encabezado", () => {
    const table = renderTable()

    expect(table.getByRole("button", { name: "Qué significa Por recibir" })).toBeTruthy()
  })

  it("expone la misma definición en cada tarjeta móvil", () => {
    renderTable()

    for (const card of screen.getAllByRole("article")) {
      expect(within(card).getByRole("button", { name: "Qué significa Por recibir" })).toBeTruthy()
    }
  })

  it("muestra lo por recibir de cada línea en su propia columna", () => {
    const table = renderTable([
      { id: "ws-1", name: "Biodiversa", items: [line({ id: "s-1", quantity: 73, incoming: 300 })] },
      { id: "ws-2", name: "Masisa", items: [line({ id: "s-2", worksiteId: "ws-2", quantity: 4 })] },
    ])

    expect(cells(table, 1)).toEqual(["73", "4"])
    expect(cells(table, 2)).toEqual(["300", "0"])
  })

  it("rotula los encabezados ordenables en mayúsculas como el resto: un <button> no hereda text-transform", () => {
    const table = renderTable()

    for (const label of ["Producto", "En bodega", "Último movimiento"]) {
      const header = table.getByRole("columnheader", { name: label })
      expect(within(header).getByRole("button")).toHaveClass("uppercase")
    }
  })

  it("reserva ancho para Producto y conserva el scroll horizontal en tablet", () => {
    renderTable()
    const table = screen.getByRole("table")
    const columns = table.querySelectorAll("colgroup col")

    expect(table).toHaveClass("min-w-[768px]", "table-fixed")
    expect(columns).toHaveLength(4)
    expect(columns[0]).toHaveClass("w-80")
    expect(table.closest('[role="region"]')).toHaveClass("overflow-x-auto")
  })

  it("usa una sola tabla para todas las faenas, para que las cantidades alineen entre grupos", () => {
    const table = renderTable()

    expect(screen.getAllByRole("table")).toHaveLength(1)
    expect(table.getByRole("rowheader", { name: /Biodiversa/ })).toBeTruthy()
    expect(table.getByRole("rowheader", { name: /Masisa/ })).toBeTruthy()
  })

  it("deja la columna de cantidad con dígitos puros y manda la unidad junto al SKU", () => {
    const table = renderTable()

    expect(cells(table, 1)).toEqual(["200", "4"])
    expect(table.getAllByText("EPP-TRECK-008 · unidad")).toHaveLength(2)
  })

  /** Un producto pedido para una faena a la que nunca entró. */
  function renderSinRegistro() {
    return renderTable([
      {
        id: "ws-1",
        name: "Biodiversa",
        items: [line({ id: "sin-registro", productId: "p-9", quantity: 0, incoming: 100, hasStockRecord: false })],
      },
    ])
  }

  it("no enlaza a un kardex vacío lo que nunca tuvo movimientos", () => {
    const table = renderSinRegistro()

    expect(table.getByText("Buzo Dupont Tyvek")).toBeTruthy()
    expect(table.queryByRole("link")).toBeNull()
  })

  it("resume en productos, sin la jerga de 'líneas de stock'", () => {
    render(
      <StockTable
        worksites={[{
          id: "ws-1",
          name: "Biodiversa",
          items: [
            line({ id: "s-1", quantity: 3 }),
            line({ id: "s-2", productId: "p-2", quantity: 0, incoming: 5, hasStockRecord: false }),
          ],
        }]}
      />,
    )

    expect(screen.getByText("2 productos en 1 faena · 1 sólo por recibir")).toBeTruthy()
    expect(screen.queryByText(/líneas? de stock/)).toBeNull()
  })

  it("lleva del producto a su propio kardex", () => {
    const table = renderTable()

    const href = table.getAllByRole("link")[0]?.getAttribute("href") ?? ""
    expect(href).toContain("vista=kardex")
    expect(href).toContain("producto=p-1")
  })

  it("acompaña la fecha del último movimiento con su distancia en días", () => {
    const table = renderTable()

    expect(cells(table, 3)).toEqual([`${formatDate(WORKSITES[0]!.items[0]!.lastMovementAt!)}hoy`, "—"])
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

  it("suma en el grupo de producto lo que hay en bodega, no lo que está por recibir", () => {
    renderTable([
      { id: "ws-1", name: "Biodiversa", items: [line({ id: "s-1", quantity: 3, incoming: 20 })] },
      { id: "ws-2", name: "Masisa", items: [line({ id: "s-2", worksiteId: "ws-2", quantity: 4, incoming: 6 })] },
    ])
    fireEvent.click(screen.getByRole("button", { name: "Por producto" }))

    expect(screen.getByRole("rowheader", { name: /7 unidades en 2 faenas/ })).toBeTruthy()
    expect(screen.queryByRole("rowheader", { name: /33 unidades/ })).toBeNull()
  })

  it("conserva la agrupación elegida entre montajes: recargar o volver a Bodega monta la tabla de nuevo", () => {
    renderTable()
    fireEvent.click(screen.getByRole("button", { name: "Por producto" }))
    cleanup()

    renderTable()
    expect(screen.getByRole("button", { name: "Por producto" })).toHaveAttribute("aria-pressed", "true")
  })
})

describe("StockTable — contexto por fila", () => {
  it("atenúa lo que está en cero frente a lo que sí hay", () => {
    const table = renderTable([
      { id: "ws-1", name: "Biodiversa", items: [
        line({ id: "s-1", quantity: 12 }),
        line({ id: "s-2", productId: "p-2", quantity: 0, incoming: 5 }),
      ] },
    ])

    const [stocked, empty] = (table.getAllByRole("row") as HTMLElement[])
      .filter((row) => within(row).queryAllByRole("cell").length > 0)
      .map((row) => within(row).getAllByRole("cell")[1]!.firstElementChild as HTMLElement)
    expect(stocked).toHaveClass("font-semibold")
    expect(empty).not.toHaveClass("font-semibold")
    expect(empty?.className).toContain("text-faint")
  })

  it("el nombre del producto dice, con un título y un ícono, que lleva a sus movimientos", () => {
    const table = renderTable()

    const link = table.getAllByRole("link")[0]!
    expect(link).toHaveAttribute("title", "Ver movimientos de Buzo Dupont Tyvek")
    expect(link.querySelector("svg")).not.toBeNull()
  })

  it("sin permisos no hay columna de acciones ni menú", () => {
    const table = renderTable()

    expect(screen.getByRole("table").querySelectorAll("colgroup col")).toHaveLength(4)
    expect(table.queryByRole("button", { name: /^Acciones para/ })).toBeNull()
  })

  it("con permiso de entregar o ajustar, cada fila trae su menú de acciones", () => {
    render(<StockTable worksites={WORKSITES} canDeliver canAdjust />)
    const table = within(screen.getByRole("table"))

    expect(screen.getByRole("table").querySelectorAll("colgroup col")).toHaveLength(5)
    expect(table.getAllByRole("button", { name: "Acciones para Buzo Dupont Tyvek" })).toHaveLength(2)
    expect(table.getByRole("columnheader", { name: "Acciones" })).toBeTruthy()
  })
})

describe("WarehouseHeaderMetrics", () => {
  it("el KPI de movimientos lleva a Movimientos filtrado por la misma ventana de días", () => {
    render(
      <WarehouseHeaderMetrics
        worksiteCount={1} worksitesWithStock={1} productsWithStock={6}
        movementCount={13} movementWindowDays={30} movementSince="2026-09-05"
      />,
    )

    const link = screen.getByRole("link", { name: /Movimientos · 30 d/ })
    expect(link.getAttribute("href")).toBe("/bodega?vista=kardex&desde=2026-09-05")
  })

  it("conserva la faena a la vista al enlazar a Movimientos", () => {
    render(
      <WarehouseHeaderMetrics
        scopeParam="faena=todas" worksiteCount={3} worksitesWithStock={2} productsWithStock={6}
        movementCount={13} movementWindowDays={30} movementSince="2026-09-05"
      />,
    )

    expect(screen.getByRole("link", { name: /Movimientos · 30 d/ }).getAttribute("href"))
      .toBe("/bodega?faena=todas&vista=kardex&desde=2026-09-05")
  })

  it("'Productos con stock' no es un enlace a la misma pantalla: repetía el subtítulo de la tabla", () => {
    render(<WarehouseHeaderMetrics worksiteCount={7} worksitesWithStock={5} productsWithStock={6} movementCount={13} movementWindowDays={30} />)

    expect(screen.getByText("Productos con stock")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Productos con stock/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /Faenas con stock/ })).toBeNull()
  })


  it("no muestra el KPI de bajo mínimo", () => {
    render(<WarehouseHeaderMetrics worksiteCount={7} worksitesWithStock={5} productsWithStock={6} movementCount={13} movementWindowDays={30} />)

    expect(screen.getByText("Productos con stock")).toBeTruthy()
    expect(screen.queryByText(/mínimo/i)).toBeNull()
  })
})

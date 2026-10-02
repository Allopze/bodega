// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { formatDate } from "@/lib/utils"

vi.mock("./actions", () => ({ setMinStockAction: vi.fn(async () => ({ ok: true, message: "Stock mínimo actualizado a 5" })) }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("./stock-export-button", () => ({ StockExportButton: () => null }))

import { StockTable } from "./stock-table"
import { setMinStockAction } from "./actions"
import { toast } from "@/lib/toast"
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
  it("etiqueta todas las columnas: sin <thead> nadie sabe qué es la fecha ni el mínimo", () => {
    const table = renderTable()

    for (const label of ["Producto", "Estado", "En bodega", "Por recibir", "Mínimo", "Último movimiento"]) {
      expect(table.getByRole("columnheader", { name: label })).toBeTruthy()
    }
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

    expect(cells(table, 2)).toEqual(["73", "4"])
    expect(cells(table, 3)).toEqual(["300", "0"])
  })

  it("rotula los encabezados ordenables en mayúsculas como el resto: un <button> no hereda text-transform", () => {
    const table = renderTable()

    for (const label of ["Producto", "En bodega", "Mínimo", "Último movimiento"]) {
      const header = table.getByRole("columnheader", { name: label })
      expect(within(header).getByRole("button")).toHaveClass("uppercase")
    }
  })

  it("reserva ancho para Producto y conserva el scroll horizontal en tablet", () => {
    renderTable()
    const table = screen.getByRole("table")
    const columns = table.querySelectorAll("colgroup col")

    expect(table).toHaveClass("min-w-[1024px]", "table-fixed")
    expect(columns).toHaveLength(6)
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

    expect(cells(table, 2)).toEqual(["200", "4"])
    expect(table.getAllByText("EPP-TRECK-008 · unidad")).toHaveLength(2)
  })

  it("ofrece definir el mínimo en vez de mostrar un guion muerto", () => {
    const table = renderTable()

    expect(table.getAllByRole("button", { name: /definir stock mínimo/i })).toHaveLength(2)
  })

  /** Una faena con quiebre y otra sin umbral definido. */
  function renderConQuiebre() {
    return renderTable([
      { id: "ws-1", name: "Biodiversa", items: [line({ id: "s-1", quantity: 1, minStock: 5 })] },
      { id: "ws-2", name: "Masisa", items: [line({ id: "s-2", worksiteId: "ws-2", quantity: 4 })] },
    ])
  }

  it("dice el estado con palabras y no sólo con un punto de color", () => {
    const table = renderConQuiebre()

    expect(table.getByText("Bajo mínimo")).toBeTruthy()
  })

  it("deja de repetir 'Sin mínimo' fila por fila: era una columna de puro ruido", () => {
    const table = renderConQuiebre()

    expect(table.queryByText("Sin mínimo")).toBeNull()
  })

  it("ofrece reponer donde hay quiebre, con faena, producto y déficit en el enlace", () => {
    const table = renderConQuiebre()

    const href = table.getByRole("link", { name: "Reponer" }).getAttribute("href") ?? ""
    expect(href).toContain("faena=ws-1")
    expect(href).toContain("producto=p-1")
    // El déficit, no la cantidad: mínimo 5 con 1 en bodega son 4 por pedir.
    expect(href).toContain("cantidad=4")
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

  it("no ofrece definir el mínimo de lo que nunca llegó, y dice por qué", () => {
    const table = renderSinRegistro()

    expect(table.queryByRole("button", { name: /definir stock mínimo/i })).toBeNull()
    expect(table.getByText("Se define al llegar")).toBeTruthy()
  })

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

    expect(cells(table, 5)).toEqual([`${formatDate(WORKSITES[0]!.items[0]!.lastMovementAt!)}hoy`, "—"])
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

describe("WarehouseHeaderMetrics", () => {
  const base = { worksiteCount: 7, worksitesWithStock: 5, productsWithStock: 6, movementCount: 13, warnStockCount: 0, movementWindowDays: 30 }

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

describe("MinStockCell", () => {
  /** Entra en modo edición sobre la primera fila de la tabla de escritorio. */
  function editarPrimerMinimo() {
    const table = renderTable()
    fireEvent.click(table.getAllByRole("button", { name: /definir stock mínimo/i })[0]!)
    return table
  }

  it("sale de la edición con Escape y restaura el valor: un clic accidental no traba la fila", () => {
    const table = editarPrimerMinimo()
    const input = table.getByRole("spinbutton", { name: "Stock mínimo" }) as HTMLInputElement
    fireEvent.change(input, { target: { value: "42" } })

    fireEvent.keyDown(input, { key: "Escape" })

    expect(table.queryByRole("spinbutton", { name: "Stock mínimo" })).toBeNull()
    fireEvent.click(table.getAllByRole("button", { name: /definir stock mínimo/i })[0]!)
    expect((table.getByRole("spinbutton", { name: "Stock mínimo" }) as HTMLInputElement).value).toBe("0")
  })

  it("ofrece un botón de cancelar, no sólo la tecla", () => {
    const table = editarPrimerMinimo()

    fireEvent.click(table.getByRole("button", { name: /cancelar edición del stock mínimo/i }))

    expect(table.queryByRole("spinbutton", { name: "Stock mínimo" })).toBeNull()
  })

  it("avisa cuando el guardado falla, en vez de quedarse callado", async () => {
    vi.mocked(setMinStockAction).mockResolvedValueOnce({ ok: false, message: "No tienes acceso a esta faena" })
    const table = editarPrimerMinimo()

    fireEvent.click(table.getByRole("button", { name: /guardar stock mínimo/i }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("No tienes acceso a esta faena")
    })
  })
})

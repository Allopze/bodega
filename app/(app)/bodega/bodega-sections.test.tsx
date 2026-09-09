// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/layout/header-context", () => ({
  useSafeShellHeader: () => ({ searchQuery: "", setSearchQuery: vi.fn() }),
}))

/** La tabla real tiene su propia suite; acá sólo importa QUÉ filas recibe. */
vi.mock("./stock-table", () => ({
  StockTable: ({ worksites }: { worksites: Array<{ id: string; name: string; items: Array<{ id: string }> }> }) => (
    <div data-testid="stock-table">
      {worksites.map((ws) => (
        <div key={ws.id} data-testid={`grupo-${ws.id}`}>
          {ws.name}: {ws.items.map((item) => item.id).join(",")}
        </div>
      ))}
    </div>
  ),
}))
vi.mock("./kardex-table", () => ({
  KardexTable: ({ movements }: { movements: unknown[] }) => (
    <div data-testid="kardex-table">{movements.length}</div>
  ),
}))
vi.mock("@/components/ui/server-pagination", () => ({
  ServerPagination: () => <div data-testid="paginacion" />,
}))

import { StockSection, KardexSection } from "./bodega-sections"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"

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
    pendingDemand: 0,
    incoming: 0,
    projectedBalance: 0,
    ...overrides,
  }
}

afterEach(cleanup)

describe("StockSection · modo bajo mínimo", () => {
  it("lista la línea agotada con mínimo definido: es la que cuenta el KPI del encabezado", () => {
    render(
      <StockSection
        worksites={[{ id: "ws-1", name: "Biodiversa" }]}
        stockByWorksite={{ "ws-1": [line({ id: "s-agotada", quantity: 0, minStock: 5 })] }}
        stockState="low"
      />,
    )

    // Antes el filtro exigía `quantity > 0` y esta fila era invisible, así que
    // el KPI decía "1 bajo mínimo" y la vista "Nada bajo el mínimo".
    expect(screen.getByTestId("grupo-ws-1").textContent).toContain("s-agotada")
  })

  it("no rotula 'Sin stock' a una faena llena que sólo no tiene nada bajo el mínimo", () => {
    render(
      <StockSection
        worksites={[
          { id: "ws-1", name: "Biodiversa" },
          { id: "ws-2", name: "Masisa" },
        ]}
        stockByWorksite={{
          "ws-1": [line({ id: "s-1", quantity: 1, minStock: 5 })],
          "ws-2": [line({ id: "s-2", worksiteId: "ws-2", quantity: 200 })],
        }}
        stockState="low"
      />,
    )

    expect(screen.queryByText(/Sin stock:/)).toBeNull()
    expect(screen.queryByText(/Masisa/)).toBeNull()
  })
})

describe("StockSection · modo normal", () => {
  it("el pie 'Sin stock' nombra sólo las faenas realmente vacías", () => {
    render(
      <StockSection
        worksites={[
          { id: "ws-1", name: "Biodiversa" },
          { id: "ws-2", name: "Masisa" },
        ]}
        stockByWorksite={{
          "ws-1": [line({ id: "s-1", quantity: 200 })],
          "ws-2": [line({ id: "s-2", worksiteId: "ws-2", quantity: 0 })],
        }}
      />,
    )

    expect(screen.getByText(/Sin stock:/)).toBeTruthy()
    expect(screen.getByText("Masisa")).toBeTruthy()
    expect(screen.getByTestId("grupo-ws-1").textContent).toContain("s-1")
  })

  it("oculta las líneas en cero cuando no se pide el filtro de mínimo", () => {
    render(
      <StockSection
        worksites={[{ id: "ws-1", name: "Biodiversa" }]}
        stockByWorksite={{ "ws-1": [line({ id: "s-cero", quantity: 0, minStock: 5 })] }}
      />,
    )

    expect(screen.queryByTestId("stock-table")).toBeNull()
    expect(screen.getByText("Sin stock registrado")).toBeTruthy()
  })
})

describe("KardexSection", () => {
  const pagination = { page: 1, totalItems: 60, totalPages: 3, offset: 0, limit: 20, from: 1, to: 20 }
  const movement: InventoryMovementWithRelations = {
    id: "m-1", worksiteId: "ws-1", productId: "p-1", type: "ingreso_oc",
    quantity: 5, stockAfter: 5, performedAt: "2026-08-12T10:00:00.000Z",
    reason: null, notes: null, product: { name: "Buzo" }, worksite: { name: "Biodiversa" },
  }

  it("no deja una paginación huérfana cuando la página filtrada queda vacía", () => {
    render(
      <KardexSection movements={[]} worksites={[]} canExport={false} pagination={pagination} searchParams={{}} />,
    )

    expect(screen.getByTestId("kardex-table")).toBeTruthy()
    expect(screen.queryByTestId("paginacion")).toBeNull()
  })

  it("mantiene la paginación mientras haya filas", () => {
    render(
      <KardexSection movements={[movement]} worksites={[]} canExport={false} pagination={pagination} searchParams={{}} />,
    )

    expect(screen.getByTestId("paginacion")).toBeTruthy()
  })
})

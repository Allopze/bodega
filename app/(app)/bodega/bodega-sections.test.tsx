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
    lastMovementAt: null,
    updatedAt: "2026-08-10T00:00:00.000Z",
    product: { name: "Buzo Dupont Tyvek", sku: "EPP-TRECK-008", unitOfMeasure: "unidad" },
    worksite: null,
    incoming: 0,
    hasStockRecord: true,
    ...overrides,
  }
}

afterEach(cleanup)

describe("StockSection", () => {
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

  it("muestra lo que está en cero si tiene algo por recibir", () => {
    render(
      <StockSection
        worksites={[{ id: "ws-1", name: "Biodiversa" }]}
        stockByWorksite={{
          "ws-1": [
            line({ id: "s-por-llegar", quantity: 0, incoming: 100, hasStockRecord: false }),
            line({ id: "s-cero", productId: "p-2", quantity: 0 }),
          ],
        }}
      />,
    )

    const grupo = screen.getByTestId("grupo-ws-1").textContent
    expect(grupo).toContain("s-por-llegar")
    expect(grupo).not.toContain("s-cero")
  })

  it("oculta las líneas en cero sin nada por recibir", () => {
    render(
      <StockSection
        worksites={[{ id: "ws-1", name: "Biodiversa" }]}
        stockByWorksite={{ "ws-1": [line({ id: "s-cero", quantity: 0 })] }}
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

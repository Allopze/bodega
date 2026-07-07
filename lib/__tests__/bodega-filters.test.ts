/**
 * Unit tests for the /bodega text-filter helpers (Task 1 of the
 * 2026-07-06 search-consistency plan).
 */

import { describe, it, expect } from "vitest"
import { filterStockItems, filterMovements } from "@/app/(app)/bodega/filters"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "@/app/(app)/bodega/types"

function stockItem(overrides: Partial<WorksiteStockWithProduct> = {}): WorksiteStockWithProduct {
  return {
    id: "s1",
    worksiteId: "ws1",
    productId: "p1",
    quantity: 10,
    minStock: 2,
    lastMovementAt: null,
    updatedAt: "2026-07-01T00:00:00.000Z",
    product: { name: "Cemento Portland", sku: "CEM-001", unitOfMeasure: "saco" },
    worksite: { name: "Faena Norte" },
    ...overrides,
  }
}

function movement(overrides: Partial<InventoryMovementWithRelations> = {}): InventoryMovementWithRelations {
  return {
    id: "m1",
    worksiteId: "ws1",
    productId: "p1",
    type: "ingreso_oc",
    quantity: 5,
    stockAfter: 15,
    performedAt: "2026-07-01T00:00:00.000Z",
    reason: null,
    notes: null,
    product: { name: "Cemento Portland" },
    worksite: { name: "Faena Norte" },
    ...overrides,
  }
}

describe("filterStockItems()", () => {
  it("returns all items when the query is empty", () => {
    const items = [stockItem(), stockItem({ id: "s2", product: { name: "Fierro 8mm", sku: null, unitOfMeasure: "u" } })]
    expect(filterStockItems(items, "")).toHaveLength(2)
  })

  it("matches by product name", () => {
    const items = [stockItem(), stockItem({ id: "s2", product: { name: "Fierro 8mm", sku: null, unitOfMeasure: "u" } })]
    expect(filterStockItems(items, "fierro")).toEqual([items[1]])
  })

  it("matches by SKU", () => {
    const items = [stockItem()]
    expect(filterStockItems(items, "CEM-001")).toEqual(items)
  })

  it("returns an empty array when nothing matches", () => {
    expect(filterStockItems([stockItem()], "no existe")).toEqual([])
  })
})

describe("filterMovements()", () => {
  it("returns all movements when the query is empty", () => {
    expect(filterMovements([movement()], "")).toHaveLength(1)
  })

  it("matches by product name", () => {
    expect(filterMovements([movement()], "cemento")).toHaveLength(1)
  })

  it("matches by worksite name", () => {
    expect(filterMovements([movement()], "norte")).toHaveLength(1)
  })

  it("matches by reason or notes", () => {
    const withReason = movement({ reason: "Ajuste por conteo físico" })
    expect(filterMovements([withReason], "conteo")).toEqual([withReason])
  })

  it("returns an empty array when nothing matches", () => {
    expect(filterMovements([movement()], "no existe")).toEqual([])
  })
})

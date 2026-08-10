/**
 * Unit tests for order-totals pure function.
 */

import { describe, it, expect } from "vitest"

import { computeLineSubtotal, computeOrderTotals } from "@/lib/order-totals"

describe("computeOrderTotals", () => {
  it("calculates totals for single item", () => {
    const result = computeOrderTotals([
      { quantity: 10, unitPrice: 5000 },
    ])
    expect(result.netAmount).toBe(50000)
    // tax at 19% = 9500
    expect(result.taxAmount).toBe(9500)
    expect(result.totalAmount).toBe(59500)
  })

  it("calculates totals for multiple items", () => {
    const result = computeOrderTotals([
      { quantity: 10, unitPrice: 5000 },
      { quantity: 5, unitPrice: 2000 },
    ])
    expect(result.netAmount).toBe(60000) // 50000 + 10000
    expect(result.taxAmount).toBe(11400)
    expect(result.totalAmount).toBe(71400)
  })

  it("applies discount correctly", () => {
    const result = computeOrderTotals([
      { quantity: 10, unitPrice: 5000, discount: 10 },
    ])
    // 10 * 5000 * 0.9 = 45000
    expect(result.netAmount).toBe(45000)
    expect(result.taxAmount).toBe(8550)
    expect(result.totalAmount).toBe(53550)
  })

  it("handles empty items array", () => {
    const result = computeOrderTotals([])
    expect(result.netAmount).toBe(0)
    expect(result.taxAmount).toBe(0)
    expect(result.totalAmount).toBe(0)
  })

  it("handles items without discount (undefined)", () => {
    const result = computeOrderTotals([
      { quantity: 1, unitPrice: 100 },
    ])
    expect(result.netAmount).toBe(100)
    expect(result.taxAmount).toBe(19)
    expect(result.totalAmount).toBe(119)
  })

  it("el neto es la suma de los subtotales redondeados por línea", () => {
    const result = computeOrderTotals([
      { quantity: 1, unitPrice: 1990, discount: 15 },
      { quantity: 1, unitPrice: 1990, discount: 15 },
    ])
    // cada línea se persiste como Math.round(1691,5) = 1692
    expect(result.netAmount).toBe(3384)
    expect(result.taxAmount).toBe(643)
    expect(result.totalAmount).toBe(4027)
  })

  it("rounds correctly", () => {
    const result = computeOrderTotals([
      { quantity: 3, unitPrice: 3333 },
    ])
    // 3 * 3333 = 9999
    expect(result.netAmount).toBe(9999)
    // 9999 * 0.19 = 1899.81 → rounded to 1900
    expect(result.taxAmount).toBe(1900)
    expect(result.totalAmount).toBe(11899)
  })

  // ── Costo pendiente (servicios sin precio conocido) ─────────────────────────

  it("no suma las líneas con costo pendiente y las cuenta aparte", () => {
    const result = computeOrderTotals([
      { quantity: 10, unitPrice: 5000 },
      { quantity: 1, unitPrice: null },
      { quantity: 2, unitPrice: null },
    ])
    // El total conocido es el del EPP: un servicio sin precio no suma 0,
    // porque 0 significaría que salió gratis.
    expect(result.netAmount).toBe(50000)
    expect(result.taxAmount).toBe(9500)
    expect(result.totalAmount).toBe(59500)
    expect(result.pendingCostLines).toBe(2)
  })

  it("una OC de puros servicios pendientes queda en 0 pero declara las líneas", () => {
    const result = computeOrderTotals([{ quantity: 1, unitPrice: null }])
    expect(result.totalAmount).toBe(0)
    expect(result.pendingCostLines).toBe(1)
  })

  it("distingue el costo cero real del costo desconocido", () => {
    const gratis = computeOrderTotals([{ quantity: 1, unitPrice: 0 }])
    expect(gratis.pendingCostLines).toBe(0)
    expect(gratis.totalAmount).toBe(0)

    const desconocido = computeOrderTotals([{ quantity: 1, unitPrice: null }])
    expect(desconocido.pendingCostLines).toBe(1)
  })

  it("recalcula los totales cuando el costo real se registra después", () => {
    const antes = computeOrderTotals([
      { quantity: 10, unitPrice: 5000 },
      { quantity: 2, unitPrice: null },
    ])
    expect(antes.totalAmount).toBe(59500)

    const despues = computeOrderTotals([
      { quantity: 10, unitPrice: 5000 },
      { quantity: 2, unitPrice: 15000 },
    ])
    expect(despues.netAmount).toBe(80000)
    expect(despues.totalAmount).toBe(95200)
    expect(despues.pendingCostLines).toBe(0)
  })
})

describe("computeLineSubtotal", () => {
  it("devuelve null mientras el costo siga pendiente", () => {
    expect(computeLineSubtotal(3, null)).toBeNull()
  })

  it("aplica cantidad y descuento con el mismo redondeo que la OC", () => {
    expect(computeLineSubtotal(1, 1990, 15)).toBe(1692)
    expect(computeLineSubtotal(2, 15000)).toBe(30000)
    expect(computeLineSubtotal(2, 0)).toBe(0)
  })
})

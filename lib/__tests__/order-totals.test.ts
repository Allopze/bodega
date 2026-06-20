/**
 * Unit tests for order-totals pure function.
 */

import { describe, it, expect } from "vitest"

import { computeOrderTotals } from "@/lib/order-totals"

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
})

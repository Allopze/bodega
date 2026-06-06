/**
 * Unit tests for computeOrderTotals.
 * Chilean IVA (VAT) = 19%.
 */

import { describe, it, expect } from "vitest"
import { computeOrderTotals } from "@/lib/order-totals"

describe("computeOrderTotals", () => {
  it("returns zeros for empty item list", () => {
    const result = computeOrderTotals([])
    expect(result).toEqual({ netAmount: 0, taxAmount: 0, totalAmount: 0 })
  })

  it("computes net, 19% IVA, and total for a single item", () => {
    // 10 units × $1000 = $10,000 net; IVA = $1,900; total = $11,900
    const result = computeOrderTotals([{ quantity: 10, unitPrice: 1000 }])
    expect(result.netAmount).toBe(10000)
    expect(result.taxAmount).toBe(1900)
    expect(result.totalAmount).toBe(11900)
  })

  it("sums multiple line items", () => {
    // Item 1: 2 × 500 = 1000
    // Item 2: 3 × 200 = 600
    // Net = 1600; IVA = 304; total = 1904
    const result = computeOrderTotals([
      { quantity: 2, unitPrice: 500 },
      { quantity: 3, unitPrice: 200 },
    ])
    expect(result.netAmount).toBe(1600)
    expect(result.taxAmount).toBe(304)
    expect(result.totalAmount).toBe(1904)
  })

  it("applies line-level discount (percentage)", () => {
    // 10 × 1000 with 10% discount = 9000 net; IVA = 1710; total = 10710
    const result = computeOrderTotals([{ quantity: 10, unitPrice: 1000, discount: 10 }])
    expect(result.netAmount).toBe(9000)
    expect(result.taxAmount).toBe(1710)
    expect(result.totalAmount).toBe(10710)
  })

  it("treats missing discount as 0%", () => {
    const withDiscount    = computeOrderTotals([{ quantity: 5, unitPrice: 200, discount: 0 }])
    const withoutDiscount = computeOrderTotals([{ quantity: 5, unitPrice: 200 }])
    expect(withDiscount).toEqual(withoutDiscount)
  })

  it("rounds net, tax, and total to whole pesos (CLP has no centavos)", () => {
    // 1 × 999 = 999 net; IVA = 189.81 → rounded to 190; total = 1189
    const result = computeOrderTotals([{ quantity: 1, unitPrice: 999 }])
    expect(Number.isInteger(result.netAmount)).toBe(true)
    expect(Number.isInteger(result.taxAmount)).toBe(true)
    expect(Number.isInteger(result.totalAmount)).toBe(true)
  })

  it("handles 100% discount correctly (free item)", () => {
    const result = computeOrderTotals([{ quantity: 5, unitPrice: 1000, discount: 100 }])
    expect(result.netAmount).toBe(0)
    expect(result.taxAmount).toBe(0)
    expect(result.totalAmount).toBe(0)
  })

  it("handles fractional quantities", () => {
    // 0.5 × 1000 = 500 net; IVA = 95; total = 595
    const result = computeOrderTotals([{ quantity: 0.5, unitPrice: 1000 }])
    expect(result.netAmount).toBe(500)
    expect(result.taxAmount).toBe(95)
    expect(result.totalAmount).toBe(595)
  })

  it("total = net + tax (always consistent)", () => {
    const cases = [
      [{ quantity: 1, unitPrice: 1 }],
      [{ quantity: 100, unitPrice: 50000 }],
      [{ quantity: 3, unitPrice: 333, discount: 5 }],
    ]
    for (const items of cases) {
      const r = computeOrderTotals(items)
      expect(r.totalAmount).toBe(r.netAmount + r.taxAmount)
    }
  })
})

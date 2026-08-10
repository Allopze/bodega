import { describe, expect, it } from "vitest"
import { getPurchasableCoverage } from "./purchasable-coverage"

describe("getPurchasableCoverage", () => {
  it("does not offer an approved item already fully covered by an active purchase order", () => {
    const [coverage] = getPurchasableCoverage(
      [{ id: "item-1", quantity: 12, status: "approved" }],
      [{ requestItemId: "item-1", quantity: 12, orderStatus: "draft", orderItemStatus: "issued", deletedAt: null }],
    )

    expect(coverage).toMatchObject({
      requestItemId: "item-1",
      activeOrderedQuantity: 12,
      remainingQuantity: 0,
      isPurchasable: false,
    })
  })

  it("keeps the split remainder purchasable without reopening the covered sibling", () => {
    const coverage = getPurchasableCoverage(
      [
        { id: "item-covered", quantity: 4, status: "in_purchase_order" },
        { id: "item-remainder", quantity: 8, status: "approved" },
      ],
      [{ requestItemId: "item-covered", quantity: 4, orderStatus: "sent", orderItemStatus: "issued", deletedAt: null }],
    )

    expect(coverage.find((item) => item.requestItemId === "item-covered")).toMatchObject({
      remainingQuantity: 0,
      isPurchasable: false,
    })
    expect(coverage.find((item) => item.requestItemId === "item-remainder")).toMatchObject({
      remainingQuantity: 8,
      isPurchasable: true,
    })
  })

  it("reopens coverage only when the order or its line is cancelled or deleted", () => {
    const coverage = getPurchasableCoverage(
      [{ id: "item-1", quantity: 3, status: "pending_purchase" }],
      [
        { requestItemId: "item-1", quantity: 3, orderStatus: "cancelled", orderItemStatus: "issued", deletedAt: null },
        { requestItemId: "item-1", quantity: 3, orderStatus: "sent", orderItemStatus: "cancelled", deletedAt: null },
        { requestItemId: "item-1", quantity: 3, orderStatus: "sent", orderItemStatus: "issued", deletedAt: "2026-08-01" },
      ],
    )

    expect(coverage[0]).toMatchObject({ activeOrderedQuantity: 0, remainingQuantity: 3, isPurchasable: true })
  })

  it("never reports a negative remaining quantity for corrupt historical coverage", () => {
    const [coverage] = getPurchasableCoverage(
      [{ id: "item-1", quantity: 2, status: "approved" }],
      [{ requestItemId: "item-1", quantity: 5, orderStatus: "received", orderItemStatus: "issued", deletedAt: null }],
    )

    expect(coverage).toMatchObject({ activeOrderedQuantity: 5, remainingQuantity: 0, isPurchasable: false, overcovered: true })
  })

  it("does not reopen a legacy partially covered source item because partial purchasing uses a sibling", () => {
    const [coverage] = getPurchasableCoverage(
      [{ id: "item-1", quantity: 12, status: "approved" }],
      [{ requestItemId: "item-1", quantity: 4, orderStatus: "sent", orderItemStatus: "issued", deletedAt: null }],
    )

    expect(coverage).toMatchObject({ activeOrderedQuantity: 4, remainingQuantity: 8, isPurchasable: false })
  })
})

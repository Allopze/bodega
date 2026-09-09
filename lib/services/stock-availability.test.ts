import { describe, expect, it } from "vitest"
import { computeStockAvailability } from "@/lib/services/stock-availability"

describe("computeStockAvailability", () => {
  it("projects physical stock after pending demand and final-faena receipts", () => {
    expect(computeStockAvailability({
      onHand: 3,
      approvedDemand: 10,
      delivered: 2,
      ordered: 10,
      receivedAtFaena: 4,
    })).toEqual({
      onHand: 3,
      pendingDemand: 8,
      incoming: 6,
      projectedBalance: 1,
    })
  })

  it("does not treat an office receipt as stock received at the final worksite", () => {
    expect(computeStockAvailability({
      onHand: 2,
      approvedDemand: 8,
      delivered: 0,
      ordered: 8,
      receivedAtFaena: 0,
    })).toEqual({
      onHand: 2,
      pendingDemand: 8,
      incoming: 8,
      projectedBalance: 2,
    })
  })

  it("retains a negative projected balance as actionable information", () => {
    expect(computeStockAvailability({
      onHand: 1,
      approvedDemand: 9,
      delivered: 2,
      ordered: 3,
      receivedAtFaena: 1,
    })).toEqual({
      onHand: 1,
      pendingDemand: 7,
      incoming: 2,
      projectedBalance: -4,
    })
  })

  it("never lets duplicate lifecycle evidence make pending or incoming negative", () => {
    expect(computeStockAvailability({
      onHand: 4,
      approvedDemand: 3,
      delivered: 5,
      ordered: 2,
      receivedAtFaena: 4,
    })).toEqual({
      onHand: 4,
      pendingDemand: 0,
      incoming: 0,
      projectedBalance: 4,
    })
  })
})

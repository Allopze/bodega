import { describe, expect, it } from "vitest"
import { decideCycleMovementMatch, decideFuelLoadMatch, decideTaeReceiptMatch, type CycleMovementCandidate, type FuelLoadCandidate, type ProviderEvidence, type TaeReceiptCandidate } from "./fuel-reconciliation"

const evidence: ProviderEvidence = {
  provider: "aramco",
  supplierId: "fs-aramco",
  productId: "fuel-diesel",
  worksiteId: "W1",
  vehicleId: "V1",
  occurredAt: "2026-08-10T12:30:00",
  quantity: 100,
  amount: 55_000,
}

function candidate(overrides: Partial<FuelLoadCandidate> = {}): FuelLoadCandidate {
  return {
    id: "load-1",
    supplierId: "fs-aramco",
    productId: "fuel-diesel",
    worksiteId: "W1",
    vehicleId: "V1",
    loadDate: "2026-08-10",
    liters: 100,
    totalAmount: 55_000,
    ...overrides,
  }
}

function cycleCandidate(overrides: Partial<CycleMovementCandidate> = {}): CycleMovementCandidate {
  return {
    id: "movement-1",
    supplierId: "fs-aramco",
    productId: "fuel-diesel",
    worksiteId: "W1",
    vehicleId: "V1",
    occurredAt: "2026-08-10T13:00:00",
    quantity: 100,
    ...overrides,
  }
}

function taeReceiptCandidate(overrides: Partial<TaeReceiptCandidate> = {}): TaeReceiptCandidate {
  return {
    id: "receipt-1",
    sourceId: "GUIDE-123",
    eventType: "received",
    productId: "fuel-diesel",
    worksiteId: "W1",
    targetLocationId: "tank-1",
    quantity: 100,
    ...overrides,
  }
}

describe("fuel provider reconciliation", () => {
  it("matches exact provider, object and values within tolerance", () => {
    expect(decideFuelLoadMatch(evidence, [candidate()])).toMatchObject({ status: "matched", candidate: { id: "load-1" } })
  })

  it("does not match a different provider even with equal values", () => {
    expect(decideFuelLoadMatch(evidence, [candidate({ supplierId: "fs-copec" })]).status).toBe("unmatched")
  })

  it("rejects a value outside the declared tolerance", () => {
    expect(decideFuelLoadMatch(evidence, [candidate({ liters: 101 })]).reason).toMatch(/tolerancia/)
  })

  it("keeps multiple exact candidates ambiguous", () => {
    expect(decideFuelLoadMatch(evidence, [candidate(), candidate({ id: "load-2" })]).status).toBe("ambiguous")
  })

  it("reconciles the physical channel by liters without comparing accounting amount", () => {
    expect(decideCycleMovementMatch(evidence, [cycleCandidate({ quantity: 100.005 })])).toMatchObject({ status: "matched", candidate: { id: "movement-1" } })
  })

  it("keeps two physical deliveries ambiguous", () => {
    expect(decideCycleMovementMatch(evidence, [cycleCandidate(), cycleCandidate({ id: "movement-2" })]).status).toBe("ambiguous")
  })

  it("matches TAE to the physical receipt by guide, destination, product and liters", () => {
    expect(decideTaeReceiptMatch({
      productId: "fuel-diesel",
      worksiteId: "W1",
      quantity: 100,
      documentNumber: "GUIDE-123",
      storageLocationId: "tank-1",
    }, [taeReceiptCandidate()])).toMatchObject({ status: "matched", candidateId: "receipt-1" })
  })

  it("does not match TAE by equal liters when the guide differs", () => {
    expect(decideTaeReceiptMatch({
      productId: "fuel-diesel",
      worksiteId: "W1",
      quantity: 100,
      documentNumber: "GUIDE-OTHER",
      storageLocationId: "tank-1",
    }, [taeReceiptCandidate()])).toMatchObject({ status: "unmatched", candidateId: null })
  })
})

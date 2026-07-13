import { describe, expect, it } from "vitest"
import { compareCycleAmounts, fuelCycleMovementSchema } from "./fuel-cycle"

const base = { worksiteId: "ws", productId: "diesel", quantity: 10, occurredAt: "2026-07-12T12:00:00.000Z" }

describe("fuel cycle movement contract", () => {
  it("requires the canonical origin for a tank delivery", () => {
    expect(fuelCycleMovementSchema.safeParse({ ...base, eventType: "tank_delivery", vehicleId: "v" }).success).toBe(false)
  })
  it("requires two different locations for a transfer", () => {
    expect(fuelCycleMovementSchema.safeParse({ ...base, eventType: "transfer", sourceLocationId: "tank", targetLocationId: "tank" }).success).toBe(false)
  })
  it("accepts a directly delivered product linked to supplier and vehicle", () => {
    expect(fuelCycleMovementSchema.safeParse({ ...base, eventType: "direct_delivery", supplierId: "supplier", vehicleId: "v" }).success).toBe(true)
  })
})

describe("cycle comparison formula", () => {
  it("calculates absolute and percentage difference", () => {
    expect(compareCycleAmounts({ liters: 120, records: 2 }, { liters: 100, records: 1 })).toEqual({ status: "available", absolute: 20, percent: 20 })
  })
  it("preserves a negative absolute and percentage difference", () => {
    expect(compareCycleAmounts({ liters: 75, records: 2 }, { liters: 100, records: 3 })).toEqual({ status: "available", absolute: -25, percent: -25 })
  })
  it("reports an absolute difference but no percentage when the comparison base is zero", () => {
    expect(compareCycleAmounts({ liters: 10, records: 1 }, { liters: 0, records: 1 })).toEqual({ status: "available", absolute: 10, percent: null })
  })
  it("does not invent a difference without both sources", () => {
    expect(compareCycleAmounts({ liters: 120, records: 2 }, null)).toEqual({ status: "unavailable", absolute: null, percent: null })
  })
})

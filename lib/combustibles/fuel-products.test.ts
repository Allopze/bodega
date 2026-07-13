import { describe, expect, it } from "vitest"
import { FUEL_PRODUCT_IDS, fuelProductIdForLegacy } from "./fuel-products"

describe("fuelProductIdForLegacy", () => {
  it.each(["Diesel", "PETROLEO DIESEL", "Petróleo Diésel"])("maps %s to diesel", (value) => {
    expect(fuelProductIdForLegacy(value)).toBe(FUEL_PRODUCT_IDS.diesel)
  })
  it.each(["BlueMax", "ADBLUE"])("maps %s to BlueMax", (value) => {
    expect(fuelProductIdForLegacy(value)).toBe(FUEL_PRODUCT_IDS.bluemax)
  })
  it("does not invent a product for an unknown historical label", () => {
    expect(fuelProductIdForLegacy("Otro")).toBe(FUEL_PRODUCT_IDS.historicalUnspecified)
  })
})

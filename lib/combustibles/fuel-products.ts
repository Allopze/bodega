export const FUEL_PRODUCT_IDS = {
  diesel: "fuel-diesel",
  bluemax: "fuel-bluemax",
  historicalUnspecified: "fuel-historical-unspecified",
} as const

export function fuelProductIdForLegacy(value: string | null | undefined) {
  const normalized = (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase()
  if (normalized.includes("BLUE") || normalized.includes("ADBLUE")) return FUEL_PRODUCT_IDS.bluemax
  if (normalized.includes("DIESEL")) return FUEL_PRODUCT_IDS.diesel
  return FUEL_PRODUCT_IDS.historicalUnspecified
}

export const FUEL_PRODUCT_IDS = {
  diesel: "fuel-diesel",
  bluemax: "fuel-bluemax",
  /** Gasolina/bencina. La cuenta Aramco la tiene habilitada (ver 0230). */
  gasoline: "fuel-gasoline",
  kerosene: "fuel-kerosene",
  historicalUnspecified: "fuel-historical-unspecified",
} as const

/**
 * Id de catálogo para el nombre de producto que entrega una fuente externa.
 *
 * El orden importa: "Aditivo BlueMax Diesel" es aditivo, no diésel, así que la
 * familia BLUE se resuelve primero. Gasolina y kerosene se agregaron porque sin
 * ficha caían en `historicalUnspecified` —un producto INACTIVO reservado para
 * cargas viejas sin producto declarado— y una compra real de bencina no es eso.
 */
export function fuelProductIdForLegacy(value: string | null | undefined) {
  const normalized = (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase()
  if (normalized.includes("BLUE") || normalized.includes("ADBLUE") || normalized.includes("FLUA")) return FUEL_PRODUCT_IDS.bluemax
  if (normalized.includes("DIESEL")) return FUEL_PRODUCT_IDS.diesel
  if (normalized.includes("GASOLINA") || normalized.includes("BENCINA") || normalized.includes("GASOLINE")) return FUEL_PRODUCT_IDS.gasoline
  if (normalized.includes("KEROSEN") || normalized.includes("PARAFINA")) return FUEL_PRODUCT_IDS.kerosene
  return FUEL_PRODUCT_IDS.historicalUnspecified
}

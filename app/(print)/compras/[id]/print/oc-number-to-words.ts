/**
 * Converts numeric CLP amounts to Spanish words for the OC print view.
 * Example: 123450 → "CIENTO VEINTITRES MIL CUATROCIENTOS CINCUENTA PESOS"
 */

export function clpAmountToWords(amount: number): string {
  const rounded = Math.round(amount)
  if (rounded === 0) return "CERO PESOS"
  return `${numberToSpanishWords(rounded).toUpperCase()} PESOS`
}

function numberToSpanishWords(value: number): string {
  if (value < 0) return `menos ${numberToSpanishWords(Math.abs(value))}`
  if (value < 30) {
    const units = [
      "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
      "diez", "once", "doce", "trece", "catorce", "quince", "dieciseis", "diecisiete",
      "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidos", "veintitres",
      "veinticuatro", "veinticinco", "veintiseis", "veintisiete", "veintiocho", "veintinueve",
    ]
    return units[value]!
  }
  if (value < 100) {
    const tens: Record<number, string> = {
      30: "treinta",
      40: "cuarenta",
      50: "cincuenta",
      60: "sesenta",
      70: "setenta",
      80: "ochenta",
      90: "noventa",
    }
    const ten = Math.floor(value / 10) * 10
    const rest = value % 10
    return rest === 0 ? tens[ten]! : `${tens[ten]} y ${numberToSpanishWords(rest)}`
  }
  if (value < 1000) {
    if (value === 100) return "cien"
    const hundreds: Record<number, string> = {
      1: "ciento",
      2: "doscientos",
      3: "trescientos",
      4: "cuatrocientos",
      5: "quinientos",
      6: "seiscientos",
      7: "setecientos",
      8: "ochocientos",
      9: "novecientos",
    }
    const hundred = Math.floor(value / 100)
    const rest = value % 100
    return rest === 0 ? hundreds[hundred]! : `${hundreds[hundred]} ${numberToSpanishWords(rest)}`
  }
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000)
    const rest = value % 1000
    const prefix = thousands === 1 ? "mil" : `${numberToSpanishWords(thousands)} mil`
    return rest === 0 ? prefix : `${prefix} ${numberToSpanishWords(rest)}`
  }
  const millions = Math.floor(value / 1_000_000)
  const rest = value % 1_000_000
  const prefix = millions === 1 ? "un millon" : `${numberToSpanishWords(millions)} millones`
  return rest === 0 ? prefix : `${prefix} ${numberToSpanishWords(rest)}`
}

/**
 * Convierte montos en CLP a palabras para la OC impresa.
 * Ejemplo: 123450 → "CIENTO VEINTITRÉS MIL CUATROCIENTOS CINCUENTA PESOS".
 *
 * En un documento comercial el monto en palabras es el que manda si la cifra se
 * discute, así que la concordancia importa: se apocopa «uno» ante sustantivo
 * masculino, se singulariza el peso y se pone el «de» que pide un millón exacto.
 */

/**
 * «uno» se apocopa en «un» cuando precede a un sustantivo masculino —peso, mil,
 * millón—: «veintiún mil pesos», no «veintiuno mil pesos». El acento existe sólo
 * en la forma apocopada: «veintiuno» se escribe sin tilde, «veintiún» con ella.
 */
function apocopate(words: string): string {
  if (words === "uno") return "un"
  if (words.endsWith("veintiuno")) return `${words.slice(0, -"veintiuno".length)}veintiún`
  if (words.endsWith(" uno")) return `${words.slice(0, -" uno".length)} un`
  return words
}

export function clpAmountToWords(amount: number): string {
  const rounded = Math.round(amount)
  if (rounded === 0) return "CERO PESOS"

  const magnitude = Math.abs(rounded)
  // El «de» va sólo cuando la cifra termina en millón/millones exactos: «dos
  // millones de pesos», pero «dos millones quinientos mil pesos» sin «de».
  const linker = magnitude >= 1_000_000 && magnitude % 1_000_000 === 0 ? "DE " : ""
  const noun = magnitude === 1 ? "PESO" : "PESOS"

  return `${apocopate(numberToSpanishWords(rounded)).toUpperCase()} ${linker}${noun}`
}

function numberToSpanishWords(value: number): string {
  if (value < 0) return `menos ${numberToSpanishWords(Math.abs(value))}`
  if (value < 30) {
    const units = [
      "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
      "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
      "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
      "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
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
    // 1000 es «mil», nunca «un mil»; de 21.000 en adelante manda la apócope.
    const prefix = thousands === 1 ? "mil" : `${apocopate(numberToSpanishWords(thousands))} mil`
    return rest === 0 ? prefix : `${prefix} ${numberToSpanishWords(rest)}`
  }
  const millions = Math.floor(value / 1_000_000)
  const rest = value % 1_000_000
  const prefix = millions === 1 ? "un millón" : `${apocopate(numberToSpanishWords(millions))} millones`
  return rest === 0 ? prefix : `${prefix} ${numberToSpanishWords(rest)}`
}

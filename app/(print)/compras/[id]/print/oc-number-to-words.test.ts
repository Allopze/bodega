import { describe, expect, it } from "vitest"
import { clpAmountToWords } from "./oc-number-to-words"

/**
 * El monto en palabras es el que prevalece si la cifra impresa se discute, así
 * que estas pruebas cubren la concordancia —apócope, singular y el «de» del
 * millón exacto— y no sólo que el número se traduzca.
 */
describe("clpAmountToWords", () => {
  it.each([
    [0, "CERO PESOS"],
    [5, "CINCO PESOS"],
    [100, "CIEN PESOS"],
    [119_000, "CIENTO DIECINUEVE MIL PESOS"],
    [123_450, "CIENTO VEINTITRÉS MIL CUATROCIENTOS CINCUENTA PESOS"],
    [1_262_114, "UN MILLÓN DOSCIENTOS SESENTA Y DOS MIL CIENTO CATORCE PESOS"],
  ])("traduce %i", (amount, expected) => {
    expect(clpAmountToWords(amount)).toBe(expected)
  })

  // «uno» se apocopa ante sustantivo masculino, y el acento aparece sólo ahí.
  it.each([
    [1, "UN PESO"],
    [21, "VEINTIÚN PESOS"],
    [31, "TREINTA Y UN PESOS"],
    [101, "CIENTO UN PESOS"],
    [21_000, "VEINTIÚN MIL PESOS"],
    [31_000, "TREINTA Y UN MIL PESOS"],
    [21_000_000, "VEINTIÚN MILLONES DE PESOS"],
    // El sustantivo concuerda con la cantidad total, no con el último numeral:
    // 1.000.001 son muchos pesos aunque termine en «un». Sólo el monto que vale
    // exactamente 1 lleva singular.
    [1_000_001, "UN MILLÓN UN PESOS"],
  ])("apocopa uno en %i", (amount, expected) => {
    expect(clpAmountToWords(amount)).toBe(expected)
  })

  // El «de» lo pide el millón exacto; con resto por debajo, no va.
  it.each([
    [1_000_000, "UN MILLÓN DE PESOS"],
    [2_000_000, "DOS MILLONES DE PESOS"],
    [2_000_000_000, "DOS MIL MILLONES DE PESOS"],
    [2_500_000, "DOS MILLONES QUINIENTOS MIL PESOS"],
    [1_000_100, "UN MILLÓN CIEN PESOS"],
  ])("pone el «de» sólo en el millón exacto: %i", (amount, expected) => {
    expect(clpAmountToWords(amount)).toBe(expected)
  })

  it.each([
    [16, "DIECISÉIS PESOS"],
    [22, "VEINTIDÓS PESOS"],
    [23, "VEINTITRÉS PESOS"],
    [26, "VEINTISÉIS PESOS"],
  ])("acentúa %i", (amount, expected) => {
    expect(clpAmountToWords(amount)).toBe(expected)
  })

  it("redondea al peso antes de traducir", () => {
    expect(clpAmountToWords(1.4)).toBe("UN PESO")
    expect(clpAmountToWords(2.6)).toBe("TRES PESOS")
  })

  it("mantiene la concordancia en negativos", () => {
    expect(clpAmountToWords(-1)).toBe("MENOS UN PESO")
    expect(clpAmountToWords(-2_000_000)).toBe("MENOS DOS MILLONES DE PESOS")
  })
})

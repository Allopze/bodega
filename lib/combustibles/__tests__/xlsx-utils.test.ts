import { describe, it, expect } from "vitest"
import { parseChileanNumber, nullableChileanNumber, formatExcelDateUTC } from "../xlsx-utils"

describe("parseChileanNumber", () => {
  it("no se come la coma decimal cuando hay 3 o más decimales", () => {
    // La heurística anterior borraba cualquier separador seguido de 3 dígitos,
    // multiplicando por 1000 los litros y montos con 3 decimales.
    expect(parseChileanNumber("1.234,567")).toBe(1234.567)
    expect(parseChileanNumber("0,750")).toBe(0.75)
    expect(parseChileanNumber("45,750")).toBe(45.75)
    expect(parseChileanNumber("32,9194")).toBe(32.9194)
  })

  it("preserva los formatos chilenos ya soportados", () => {
    expect(parseChileanNumber("1.234.567,89")).toBe(1234567.89)
    expect(parseChileanNumber("$ 981,00")).toBe(981)
    expect(parseChileanNumber("1.234,56")).toBe(1234.56)
    expect(parseChileanNumber("10,5")).toBe(10.5)
    expect(parseChileanNumber("1.150.000")).toBe(1150000)
    expect(parseChileanNumber("12.345")).toBe(12345)
    expect(parseChileanNumber(9956.51)).toBe(9956.51)
    expect(parseChileanNumber("-")).toBe(0)
    expect(parseChileanNumber("")).toBe(0)
    expect(nullableChileanNumber("")).toBeNull()
    expect(nullableChileanNumber("1.234,567")).toBe(1234.567)
  })
})

describe("formatExcelDateUTC", () => {
  it("lee los componentes UTC del serial de Excel, no los de la zona local", () => {
    expect(formatExcelDateUTC(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01-01")
    expect(formatExcelDateUTC(new Date(Date.UTC(2025, 11, 31, 23, 59)))).toBe("2025-12-31")
  })
})

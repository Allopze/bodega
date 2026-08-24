import { describe, it, expect } from "vitest"
import { parseChileanNumber, nullableChileanNumber, formatExcelDateUTC, parseSheetDate } from "../xlsx-utils"

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

describe("parseSheetDate", () => {
  it("lee la fecha chilena como DD/MM y no como MM/DD", () => {
    // `new Date("03/02/2026")` daba el 2 de marzo. En Chile es el 3 de febrero,
    // y el error corría de mes en silencio toda carga de los días 1-12.
    expect(parseSheetDate("03/02/2026")).toBe("2026-02-03")
    expect(parseSheetDate("15-03-2026")).toBe("2026-03-15")
    expect(parseSheetDate("1/1/2026")).toBe("2026-01-01")
  })

  it("conserva el ISO y el serial de Excel", () => {
    expect(parseSheetDate("2026-03-15")).toBe("2026-03-15")
    expect(parseSheetDate("2026-03-15T10:30:00")).toBe("2026-03-15")
    expect(parseSheetDate(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01-01")
  })

  it("devuelve null en vez de adivinar", () => {
    expect(parseSheetDate("03/02/26")).toBeNull()      // año de 2 dígitos: 1926 o 2026
    expect(parseSheetDate("30/02/2026")).toBeNull()    // Date.UTC lo correría a marzo
    expect(parseSheetDate("2026/2026/15")).toBeNull()  // dos extremos de 4 dígitos
    expect(parseSheetDate("marzo 2026")).toBeNull()
    expect(parseSheetDate("")).toBeNull()
    expect(parseSheetDate(null)).toBeNull()
    expect(parseSheetDate(new Date("x"))).toBeNull()
  })
})

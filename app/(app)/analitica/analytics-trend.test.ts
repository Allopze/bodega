import { describe, expect, it } from "vitest"
import { formatTrendMonth, formatTrendMonthShort, monthlyTrendDescription } from "./analytics-trend"

describe("formatTrendMonth", () => {
  it("escribe el mes como «oct-2026», igual que el subtítulo", () => {
    expect(formatTrendMonth("2026-10")).toBe("oct-2026")
    expect(formatTrendMonth("2025-01")).toBe("ene-2025")
  })

  it("devuelve el texto original si no es una clave de mes", () => {
    expect(formatTrendMonth("raro")).toBe("raro")
  })
})

describe("formatTrendMonthShort", () => {
  it("abrevia el año para que quepan los 12 meses en el eje", () => {
    expect(formatTrendMonthShort("2026-10")).toBe("oct-26")
    expect(formatTrendMonthShort("2025-01")).toBe("ene-25")
  })

  it("devuelve el texto original si no es una clave de mes", () => {
    expect(formatTrendMonthShort("raro")).toBe("raro")
  })
})

describe("monthlyTrendDescription", () => {
  it("nombra la ventana real de 12 meses a partir de la fecha `hasta`", () => {
    expect(monthlyTrendDescription("2026-10-31", false)).toBe("Últimos 12 meses hasta oct-2026")
  })

  it("agrega el aviso de mes parcial", () => {
    expect(monthlyTrendDescription("2026-10-20", true)).toBe("Últimos 12 meses hasta oct-2026 · el último mes es parcial")
  })
})

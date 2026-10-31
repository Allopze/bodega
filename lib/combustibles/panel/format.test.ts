import { describe, expect, it } from "vitest"
import { elapsedPeriodDays, formatPercentText, formatShortDay, historyLabel, monthNameOfKey, ofPeriod, periodLengthDays, periodNounPlural, waitingPhrase } from "./format"

const TODAY = "2026-10-31"

describe("textos cortos del Panel", () => {
  it("formatShortDay pone el año sólo cuando no es el año en curso", () => {
    expect(formatShortDay("2026-10-31", TODAY)).toBe("31 oct")
    expect(formatShortDay("2026-11-05", TODAY)).toBe("5 nov")
    expect(formatShortDay("2025-12-30", TODAY)).toBe("30 dic 2025")
  })

  it("waitingPhrase cuenta por día civil de Chile, no por horas", () => {
    expect(waitingPhrase("2026-10-31T13:00:00.000Z", TODAY)).toBe("Llegó hoy")
    // 23:30 del 30 de octubre en Chile (UTC-3) es el 31 a las 02:30 UTC: sigue siendo «ayer».
    expect(waitingPhrase("2026-10-31T02:30:00.000Z", TODAY)).toBe("Espera desde ayer")
    expect(waitingPhrase("2026-10-25T14:00:00.000Z", TODAY)).toBe("Espera hace 6 días")
    // Un instante en el futuro (reloj corrido) no inventa un plazo negativo.
    expect(waitingPhrase("2026-11-02T14:00:00.000Z", TODAY)).toBe("Llegó hoy")
  })

  it("rotula cada barra de la historia según el tipo de período", () => {
    expect(historyLabel({ kind: "month", year: 2026, month: 10 }, TODAY)).toBe("oct")
    expect(historyLabel({ kind: "quarter", year: 2026, quarter: 4 }, TODAY)).toBe("4T 26")
    expect(historyLabel({ kind: "year", year: 2025 }, TODAY)).toBe("2025")
    expect(historyLabel({ kind: "week", year: 2026, week: 44 }, TODAY)).toBe("26 oct")
    expect(historyLabel({ kind: "range", from: "2025-12-15", to: "2026-01-15" }, TODAY)).toBe("15 dic")
  })

  it("ofPeriod contrae «de el» en «del»", () => {
    expect(ofPeriod("octubre")).toBe("de octubre")
    expect(ofPeriod("octubre de 2025")).toBe("de octubre de 2025")
    expect(ofPeriod("la semana del 26 de octubre")).toBe("de la semana del 26 de octubre")
    expect(ofPeriod("el 3.er trimestre")).toBe("del 3.er trimestre")
    expect(ofPeriod("2025")).toBe("de 2025")
    expect(ofPeriod("el período del 15 de septiembre al 15 de octubre")).toBe("del período del 15 de septiembre al 15 de octubre")
  })

  it("nombra lo que cuentan las barras", () => {
    expect(periodNounPlural("month")).toBe("meses")
    expect(periodNounPlural("week")).toBe("semanas")
    expect(periodNounPlural("range")).toBe("períodos")
  })

  it("nombra meses y porcentajes en español", () => {
    expect(monthNameOfKey("2026-09")).toBe("septiembre")
    expect(formatPercentText(3.1)).toBe("3,1 %")
    expect(formatPercentText(10, 0)).toBe("10 %")
  })

  it("cuenta los días de un período en curso, contando hoy y sin pasarse de su largo", () => {
    expect(periodLengthDays("2026-10-01", "2026-10-31")).toBe(31)
    expect(elapsedPeriodDays("2026-10-01", "2026-10-31", "2026-10-14")).toBe(14)
    expect(elapsedPeriodDays("2026-10-01", "2026-10-31", "2026-11-20")).toBe(31)
    expect(elapsedPeriodDays("2026-11-01", "2026-11-30", "2026-10-31")).toBe(0)
  })
})

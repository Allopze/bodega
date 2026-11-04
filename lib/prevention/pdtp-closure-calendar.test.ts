import { describe, expect, it } from "vitest"
import type { PdtpPeriod } from "@/lib/services/pdtp/period"
import { summarizeSlotCalendar } from "./slot-compliance-calendar"
import { CLOSURE_CALENDAR_WORDING, buildClosureCalendar, closureExigibleRange } from "./pdtp-closure-calendar"

// Hoy: junio de 2026.
const TODAY: PdtpPeriod = { year: 2026, month: 6, week: 2 }
const act = (year: number, month: number): PdtpPeriod => ({ year, month, week: 1 })

describe("closureExigibleRange — la regla del cierre anual", () => {
  it("desde el mes de activación hasta diciembre", () => {
    expect(closureExigibleRange({ year: 2026, activation: act(2026, 3), deactivated: null })).toEqual({ firstMonth: 3, lastMonth: 12 })
  })

  it("activado antes del año (programa importado): el año completo", () => {
    expect(closureExigibleRange({ year: 2026, activation: act(2025, 11), deactivated: null })).toEqual({ firstMonth: 1, lastMonth: 12 })
  })

  it("activado después del año: nada", () => {
    expect(closureExigibleRange({ year: 2026, activation: act(2027, 1), deactivated: null }).firstMonth).toBe(13)
  })

  it("sin activación (borrador) no se exige nada", () => {
    expect(closureExigibleRange({ year: 2026, activation: null, deactivated: null }).firstMonth).toBe(13)
  })

  it("una faena dada de baja debe los meses completos anteriores a su baja", () => {
    expect(closureExigibleRange({ year: 2026, activation: act(2026, 1), deactivated: { year: 2026, month: 5 } })).toEqual({ firstMonth: 1, lastMonth: 4 })
    expect(closureExigibleRange({ year: 2026, activation: act(2026, 1), deactivated: { year: 2025, month: 5 } }).lastMonth).toBe(0)
    expect(closureExigibleRange({ year: 2026, activation: act(2026, 1), deactivated: { year: 2027, month: 5 } }).lastMonth).toBe(12)
  })
})

describe("buildClosureCalendar", () => {
  const worksites = [
    { id: "a", label: "Faena Alfa", firstMonth: 1, lastMonth: 12 },
    { id: "b", label: "Faena Beta", firstMonth: 3, lastMonth: 12 },
  ]
  const closed = (entries: Record<string, number[]>) => new Map(Object.entries(entries).map(([id, months]) => [id, new Set(months)]))

  it("un mes cerrado es cumplido; uno pasado sin cerrar, vencido; el en curso y los futuros, por cerrar", () => {
    const calendar = buildClosureCalendar({ year: 2026, today: TODAY, worksites, closedMonths: closed({ a: [1, 2, 3, 4], b: [3] }) })
    const alfa = calendar.rows.find((row) => row.id === "a")!
    expect(alfa.cells.map((cell) => cell.status)).toEqual([
      "ok", "ok", "ok", "ok", "missing", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming",
    ])
    // Mayo (5) terminó y no se cerró: deuda. Junio (6), el mes en curso, todavía no.
    expect(alfa.missed).toBe(1)
    expect(alfa.cells[4]!.detail).toBe("0 de 1 hecho")
    expect(alfa.cells[5]!.detail).toBe("0 de 1 hecho · mes en curso")
  })

  it("los meses anteriores a la activación de la faena no se le deben", () => {
    const calendar = buildClosureCalendar({ year: 2026, today: TODAY, worksites, closedMonths: closed({}) })
    const beta = calendar.rows.find((row) => row.id === "b")!
    expect(beta.cells[0]!.status).toBe("na")
    expect(beta.cells[1]!.status).toBe("na")
    expect(beta.cells[0]!.detail).toBe("sin cierre exigible")
    // Marzo a mayo (3, 4, 5) están vencidos: tres meses de deuda.
    expect(beta.missed).toBe(3)
  })

  it("un cierre fuera del rango exigible se ve como cerrado y no como deuda", () => {
    const calendar = buildClosureCalendar({ year: 2026, today: TODAY, worksites, closedMonths: closed({ b: [1] }) })
    expect(calendar.rows.find((row) => row.id === "b")!.cells[0]!.status).toBe("ok")
  })

  it("una faena sin ningún mes exigible ni cerrado no aparece", () => {
    const calendar = buildClosureCalendar({
      year: 2026, today: TODAY, closedMonths: closed({}),
      worksites: [{ id: "x", label: "Faena Nueva", firstMonth: 13, lastMonth: 12 }],
    })
    expect(calendar.rows).toEqual([])
  })

  it("un año ya terminado sin cierres: los doce meses vencidos", () => {
    const calendar = buildClosureCalendar({ year: 2025, today: TODAY, worksites: [worksites[0]!], closedMonths: closed({}) })
    expect(calendar.rows[0]!.missed).toBe(12)
  })

  it("la frase habla de cierres y no de actividades", () => {
    const calendar = buildClosureCalendar({ year: 2026, today: TODAY, worksites, closedMonths: closed({ a: [1, 2, 3, 4, 5], b: [] }) })
    const text = summarizeSlotCalendar(calendar.rows, { noun: { singular: "faena", plural: "faenas" }, wording: CLOSURE_CALENDAR_WORDING })
    expect(text).toBe("1 de 2 faenas tiene cierres vencidos sin cumplir; la más atrasada es Faena Beta, con 3 cierres en 3 meses.")
  })

  it("con el único mes exigible todavía en curso no hay deuda que reportar", () => {
    const calendar = buildClosureCalendar({ year: 2026, today: { year: 2026, month: 1, week: 1 }, worksites: [worksites[0]!], closedMonths: closed({}) })
    // Enero está en curso: nada vencido, pero hay meses exigibles, así que no es «sin exigibles».
    expect(summarizeSlotCalendar(calendar.rows, { noun: { singular: "faena", plural: "faenas" }, wording: CLOSURE_CALENDAR_WORDING }))
      .toBe("Ninguna faena tiene cierres vencidos sin cumplir.")
  })
})

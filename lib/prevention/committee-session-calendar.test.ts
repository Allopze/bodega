import { describe, expect, it } from "vitest"
import type { PdtpPeriod } from "@/lib/services/pdtp/period"
import { summarizeSlotCalendar } from "./slot-compliance-calendar"
import { SESSION_CALENDAR_WORDING, buildSessionCalendar, sessionExigibleRange } from "./committee-session-calendar"

// Hoy: junio de 2026.
const TODAY: PdtpPeriod = { year: 2026, month: 6, week: 2 }
const held = (entries: Record<string, number[]>) => new Map(Object.entries(entries).map(([id, months]) => [id, new Set(months)]))
const noun = { singular: "comité", plural: "comités" }

describe("sessionExigibleRange", () => {
  it("un comité constituido antes del año debe los doce meses", () => {
    expect(sessionExigibleRange({ constitutedOn: "2024-03-10", dissolvedAt: null }, 2026)).toEqual({ firstMonth: 1, lastMonth: 12 })
  })

  it("constituido en el año debe desde el mes de constitución", () => {
    expect(sessionExigibleRange({ constitutedOn: "2026-04-28", dissolvedAt: null }, 2026)).toEqual({ firstMonth: 4, lastMonth: 12 })
  })

  it("constituido después del año no debe nada", () => {
    expect(sessionExigibleRange({ constitutedOn: "2027-01-05", dissolvedAt: null }, 2026).firstMonth).toBe(13)
  })

  it("disuelto en el año debe hasta el mes anterior a su disolución; en un año anterior, nada", () => {
    expect(sessionExigibleRange({ constitutedOn: "2024-03-10", dissolvedAt: "2026-08-20T15:00:00.000Z" }, 2026)).toEqual({ firstMonth: 1, lastMonth: 7 })
    expect(sessionExigibleRange({ constitutedOn: "2024-03-10", dissolvedAt: "2025-08-20T15:00:00.000Z" }, 2026).lastMonth).toBe(0)
  })

  it("la disolución se lee en el mes civil de Chile, no en UTC", () => {
    // 1 de septiembre 02:00 UTC = 31 de agosto 22:00 en Santiago: la disolución es de agosto.
    expect(sessionExigibleRange({ constitutedOn: "2024-03-10", dissolvedAt: "2026-09-01T02:00:00.000Z" }, 2026).lastMonth).toBe(7)
  })
})

describe("buildSessionCalendar", () => {
  const committees = [
    { id: "c1", label: "Faena Alfa", constitutedOn: "2024-03-10", dissolvedAt: null },
    { id: "c2", label: "Faena Beta", constitutedOn: "2026-03-15", dissolvedAt: null },
  ]

  it("un mes con acta cerrada es «sesionó»; uno pasado sin sesión, vencido; el en curso, por sesionar", () => {
    const calendar = buildSessionCalendar({ year: 2026, today: TODAY, committees, heldMonths: held({ c1: [1, 2, 3, 4], c2: [3, 4, 5] }) })
    const alfa = calendar.rows.find((row) => row.id === "c1")!
    expect(alfa.cells.slice(0, 6).map((cell) => cell.status)).toEqual(["ok", "ok", "ok", "ok", "missing", "upcoming"])
    expect(alfa.cells[4]!.detail).toBe("0 de 1 realizada")
    expect(alfa.missed).toBe(1)
    const beta = calendar.rows.find((row) => row.id === "c2")!
    expect(beta.cells.slice(0, 6).map((cell) => cell.status)).toEqual(["na", "na", "ok", "ok", "ok", "upcoming"])
    expect(beta.cells[0]!.detail).toBe("sin sesión exigible")
    expect(beta.missed).toBe(0)
  })

  it("un comité que nunca sesionó acumula un mes vencido por cada mes terminado desde su constitución", () => {
    const calendar = buildSessionCalendar({ year: 2026, today: TODAY, committees, heldMonths: held({}) })
    expect(calendar.rows.find((row) => row.id === "c1")!.missed).toBe(5)
    // Beta se constituyó en marzo: marzo, abril y mayo.
    expect(calendar.rows.find((row) => row.id === "c2")!.missed).toBe(3)
  })

  it("una sesión realizada antes de la constitución registrada se ve como realizada", () => {
    const calendar = buildSessionCalendar({ year: 2026, today: TODAY, committees, heldMonths: held({ c2: [1] }) })
    expect(calendar.rows.find((row) => row.id === "c2")!.cells[0]!.status).toBe("ok")
  })

  it("la frase habla de sesiones", () => {
    const calendar = buildSessionCalendar({ year: 2026, today: TODAY, committees, heldMonths: held({ c1: [1, 2, 3, 4, 5], c2: [] }) })
    expect(summarizeSlotCalendar(calendar.rows, { noun, wording: SESSION_CALENDAR_WORDING }))
      .toBe("1 de 2 comités tiene sesiones vencidas sin cumplir; la más atrasada es Faena Beta, con 3 sesiones en 3 meses.")
  })

  it("el año de un comité disuelto no arrastra meses posteriores a su disolución", () => {
    const calendar = buildSessionCalendar({
      year: 2026, today: TODAY, heldMonths: held({}),
      committees: [{ id: "c3", label: "Faena Gamma", constitutedOn: "2024-03-10", dissolvedAt: "2026-04-10T15:00:00.000Z" }],
    })
    // Debe enero, febrero y marzo; abril en adelante no.
    expect(calendar.rows[0]!.missed).toBe(3)
    expect(calendar.rows[0]!.cells[4]!.status).toBe("na")
  })

  it("sin comités no hay calendario", () => {
    expect(buildSessionCalendar({ year: 2026, today: TODAY, committees: [], heldMonths: held({}) }).rows).toEqual([])
  })
})

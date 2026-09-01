import { describe, expect, it } from "vitest"
import {
  currentPdtpPeriod,
  deriveActivityStatus,
  filterPdtpRowsFromActivation,
  isPdtpPeriodOnOrAfterActivation,
  type PdtpPeriod,
} from "@/lib/services/pdtp/period"

// El período se resuelve en hora de Chile, así que los casos se expresan como
// instantes UTC explícitos (mediodía chileno) y no con `new Date(y, m, d)`, que
// depende de la zona del proceso.
const atChile = (day: string) => new Date(`${day}T15:00:00Z`)

describe("currentPdtpPeriod", () => {
  it("computes year from the date", () => {
    expect(currentPdtpPeriod(atChile("2026-07-04")).year).toBe(2026)
  })

  it("computes month from the date (1-12)", () => {
    expect(currentPdtpPeriod(atChile("2026-07-04")).month).toBe(7)
  })

  it("computes week 1 for days 1-7", () => {
    expect(currentPdtpPeriod(atChile("2026-07-01")).week).toBe(1)
    expect(currentPdtpPeriod(atChile("2026-07-07")).week).toBe(1)
  })

  it("computes week 2 for days 8-14", () => {
    expect(currentPdtpPeriod(atChile("2026-07-08")).week).toBe(2)
    expect(currentPdtpPeriod(atChile("2026-07-14")).week).toBe(2)
  })

  it("computes week 3 for days 15-21", () => {
    expect(currentPdtpPeriod(atChile("2026-07-15")).week).toBe(3)
    expect(currentPdtpPeriod(atChile("2026-07-21")).week).toBe(3)
  })

  it("computes week 4 for days 22-31", () => {
    expect(currentPdtpPeriod(atChile("2026-07-22")).week).toBe(4)
    expect(currentPdtpPeriod(atChile("2026-07-28")).week).toBe(4)
    expect(currentPdtpPeriod(atChile("2026-07-31")).week).toBe(4)
  })

  // Regresión D-06: el proceso corre en UTC en producción. A las 21:00 del 31
  // de diciembre en Chile ya es 1 de enero en UTC, y el período saltaba de año.
  it("resolves the period in Chile time, not the process timezone", () => {
    const period = currentPdtpPeriod(new Date("2027-01-01T02:00:00Z"))
    expect(period.year).toBe(2026)
    expect(period.month).toBe(12)
    expect(period.week).toBe(4)
  })

  it("uses current date by default", () => {
    const period = currentPdtpPeriod()
    const now = currentPdtpPeriod(new Date())
    expect(period.year).toBe(now.year)
    expect(period.month).toBe(now.month)
  })
})

describe("vigencia del programa PDTP", () => {
  const activatedAt = "2026-07-15T15:00:00.000Z"

  it("incluye la semana de aceptación y todas las posteriores hasta fin de año", () => {
    expect(isPdtpPeriodOnOrAfterActivation({ year: 2026, month: 7, week: 2 }, activatedAt)).toBe(false)
    expect(isPdtpPeriodOnOrAfterActivation({ year: 2026, month: 7, week: 3 }, activatedAt)).toBe(true)
    expect(isPdtpPeriodOnOrAfterActivation({ year: 2026, month: 12, week: 4 }, activatedAt)).toBe(true)
  })

  it("excluye filas anteriores y conserva programas históricos sin activatedAt", () => {
    const rows = [
      { year: 2026, month: 1, week: 1, value: "antes" },
      { year: 2026, month: 7, week: 3, value: "aceptación" },
      { year: 2026, month: 10, week: 1, value: "después" },
    ]
    expect(filterPdtpRowsFromActivation(rows, activatedAt).map((row) => row.value))
      .toEqual(["aceptación", "después"])
    expect(filterPdtpRowsFromActivation(rows, null)).toBe(rows)
  })

  it("resuelve la aceptación con fecha chilena cerca de medianoche UTC", () => {
    // En Chile aún es 14 de julio (semana 2), aunque en UTC ya sea día 15.
    const nearMidnight = "2026-07-15T02:30:00.000Z"
    expect(isPdtpPeriodOnOrAfterActivation({ year: 2026, month: 7, week: 1 }, nearMidnight)).toBe(false)
    expect(isPdtpPeriodOnOrAfterActivation({ year: 2026, month: 7, week: 2 }, nearMidnight)).toBe(true)
  })
})

describe("deriveActivityStatus", () => {
  it("returns 'not_scheduled' when nothing is planned for the month", () => {
    const monthlyPlanned = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("not_scheduled")
  })

  it("returns 'executed' when something was executed in the current month", () => {
    const monthlyPlanned = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("executed")
  })

  it("returns 'pending' when planned this month but not executed and no earlier unexecuted months", () => {
    const monthlyPlanned = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("pending")
  })

  it("returns 'overdue' when planned in an earlier month with nothing executed", () => {
    const monthlyPlanned = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("overdue")
  })

  it("returns 'executed' even if there are earlier unexecuted months, as long as current month is executed", () => {
    const monthlyPlanned = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("executed")
  })

  it("handles undefined values in arrays (treats as 0)", () => {
    const monthlyPlanned = [undefined, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0] as unknown as number[]
    const monthlyExecuted = [undefined, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as unknown as number[]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("pending")
  })

  it("detects overdue when multiple earlier months have unexecuted plans", () => {
    const monthlyPlanned = [1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 2 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("overdue")
  })

  it("is pending when earlier months are fully executed but current month is not", () => {
    const monthlyPlanned = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const monthlyExecuted = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const period: PdtpPeriod = { year: 2026, month: 7, week: 1 }

    const status = deriveActivityStatus(monthlyPlanned, monthlyExecuted, period)
    expect(status).toBe("pending")
  })
})

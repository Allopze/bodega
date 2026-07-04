import { describe, expect, it } from "vitest"
import { currentPdtpPeriod, deriveActivityStatus, type PdtpPeriod } from "@/lib/services/pdtp/period"

describe("currentPdtpPeriod", () => {
  it("computes year from the date", () => {
    const period = currentPdtpPeriod(new Date(2026, 6, 4))
    expect(period.year).toBe(2026)
  })

  it("computes month from the date (1-12)", () => {
    const period = currentPdtpPeriod(new Date(2026, 6, 4))
    expect(period.month).toBe(7)
  })

  it("computes week 1 for days 1-7", () => {
    expect(currentPdtpPeriod(new Date(2026, 6, 1)).week).toBe(1)
    expect(currentPdtpPeriod(new Date(2026, 6, 7)).week).toBe(1)
  })

  it("computes week 2 for days 8-14", () => {
    expect(currentPdtpPeriod(new Date(2026, 6, 8)).week).toBe(2)
    expect(currentPdtpPeriod(new Date(2026, 6, 14)).week).toBe(2)
  })

  it("computes week 3 for days 15-21", () => {
    expect(currentPdtpPeriod(new Date(2026, 6, 15)).week).toBe(3)
    expect(currentPdtpPeriod(new Date(2026, 6, 21)).week).toBe(3)
  })

  it("computes week 4 for days 22-31", () => {
    expect(currentPdtpPeriod(new Date(2026, 6, 22)).week).toBe(4)
    expect(currentPdtpPeriod(new Date(2026, 6, 28)).week).toBe(4)
    expect(currentPdtpPeriod(new Date(2026, 6, 31)).week).toBe(4)
  })

  it("uses current date by default", () => {
    const period = currentPdtpPeriod()
    expect(period.year).toBe(new Date().getFullYear())
    expect(period.month).toBe(new Date().getMonth() + 1)
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

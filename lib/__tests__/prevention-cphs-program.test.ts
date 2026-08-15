import { describe, expect, it } from "vitest"
import {
  activityDeadline,
  deriveProgramActivityStatus,
  monthDeadline,
  summarizeProgramCompliance,
  type ProgramActivityRow,
} from "@/lib/prevention/cphs-program"

const planned = (month: number, dueOn: string | null = null): ProgramActivityRow => ({ status: "planned", plannedMonth: month, dueOn })
const done = (month: number): ProgramActivityRow => ({ status: "done", plannedMonth: month, dueOn: null })

describe("monthDeadline", () => {
  it("cierra el mes en su último día", () => {
    expect(monthDeadline(2026, 1)).toBe("2026-01-31")
    expect(monthDeadline(2026, 4)).toBe("2026-04-30")
    expect(monthDeadline(2026, 12)).toBe("2026-12-31")
  })

  it("respeta febrero bisiesto", () => {
    expect(monthDeadline(2026, 2)).toBe("2026-02-28")
    expect(monthDeadline(2028, 2)).toBe("2028-02-29")
  })
})

describe("activityDeadline", () => {
  it("un plazo explícito manda sobre el mes planificado", () => {
    expect(activityDeadline(planned(6, "2026-06-10"), 2026)).toBe("2026-06-10")
  })

  it("sin plazo explícito usa el fin del mes planificado", () => {
    expect(activityDeadline(planned(6), 2026)).toBe("2026-06-30")
  })
})

describe("deriveProgramActivityStatus", () => {
  it("no se atrasa mientras su mes no termina", () => {
    expect(deriveProgramActivityStatus(planned(8), 2026, "2026-08-13")).toBe("pending")
    expect(deriveProgramActivityStatus(planned(8), 2026, "2026-08-31")).toBe("pending")
  })

  it("se atrasa apenas pasa su plazo", () => {
    expect(deriveProgramActivityStatus(planned(8), 2026, "2026-09-01")).toBe("overdue")
  })

  it("realizada y cancelada no dependen de la fecha", () => {
    expect(deriveProgramActivityStatus(done(1), 2026, "2026-12-31")).toBe("done")
    expect(deriveProgramActivityStatus({ status: "cancelled", plannedMonth: 1, dueOn: null }, 2026, "2026-12-31")).toBe("cancelled")
  })

  it("realizar antes del mes planificado cuenta como realizada", () => {
    expect(deriveProgramActivityStatus(done(11), 2026, "2026-03-01")).toBe("done")
  })
})

describe("summarizeProgramCompliance", () => {
  it("no reporta cumplimiento mientras nada es exigible", () => {
    const summary = summarizeProgramCompliance([planned(10), planned(11), planned(12)], 2026, "2026-08-13")
    expect(summary).toMatchObject({ total: 3, due: 0, done: 0, overdue: 0, pending: 3, compliancePct: null })
  })

  /* La regresión que este caso protege: usar las 12 actividades del año como
   * denominador dejaría un programa recién aprobado en 25% "incumplido". */
  it("el denominador son las actividades exigibles, no todo el año", () => {
    const summary = summarizeProgramCompliance(
      [done(1), done(2), planned(3), planned(9), planned(12)],
      2026,
      "2026-08-13",
    )
    expect(summary).toMatchObject({ total: 5, due: 3, done: 2, overdue: 1, pending: 2 })
    expect(summary.compliancePct).toBe(67)
  })

  it("las canceladas salen del cálculo entero", () => {
    const summary = summarizeProgramCompliance(
      [done(1), { status: "cancelled", plannedMonth: 2, dueOn: null }, planned(3)],
      2026,
      "2026-08-13",
    )
    expect(summary).toMatchObject({ total: 2, due: 2, done: 1, overdue: 1, compliancePct: 50 })
  })

  it("un programa íntegramente cumplido llega a 100", () => {
    expect(summarizeProgramCompliance([done(1), done(2)], 2026, "2026-08-13").compliancePct).toBe(100)
  })
})

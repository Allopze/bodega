import { describe, expect, it } from "vitest"
import {
  currentMonthPeriod,
  defaultFuelPeriodFor,
  describeFuelPeriod,
  formatFuelPeriodCookie,
  formatFuelPeriodToken,
  fuelPeriodBounds,
  fuelPeriodPresets,
  isoWeekOf,
  legacyFuelPeriodFromParams,
  monthlyGranularityNote,
  parseFuelPeriodCookie,
  parseFuelPeriodToken,
  previousFuelPeriods,
  resolveFuelPeriod,
  shiftFuelPeriod,
  toChileInstantRange,
  toControlPeriod,
  toInvoiceFilters,
} from "./index"

const TODAY = "2026-10-30"
const OCT = { kind: "month", year: 2026, month: 10 } as const

describe("tokens", () => {
  it.each([
    ["2026-10", { kind: "month", year: 2026, month: 10 }],
    ["2026-T4", { kind: "quarter", year: 2026, quarter: 4 }],
    ["2026", { kind: "year", year: 2026 }],
    ["2026-S44", { kind: "week", year: 2026, week: 44 }],
  ])("lee %s y lo vuelve a escribir igual", (token, period) => {
    expect(parseFuelPeriodToken(token)).toEqual(period)
    expect(formatFuelPeriodToken(period as never)).toBe(token)
  })

  it.each(["2026-13", "2026-T5", "2026-S54", "1999", "abc", ""])("rechaza %s", (token) => {
    expect(parseFuelPeriodToken(token)).toBeNull()
  })

  it("acepta la semana 53 sólo en años que la tienen", () => {
    expect(parseFuelPeriodToken("2026-S53")).toEqual({ kind: "week", year: 2026, week: 53 })
    expect(parseFuelPeriodToken("2027-S53")).toBeNull()
  })

  it("la cookie guarda también los rangos", () => {
    const range = { kind: "range", from: "2026-09-15", to: "2026-10-15" } as const
    expect(formatFuelPeriodCookie(range)).toBe("r:2026-09-15:2026-10-15")
    expect(parseFuelPeriodCookie("r:2026-09-15:2026-10-15")).toEqual(range)
    expect(parseFuelPeriodCookie("2026-10")).toEqual(OCT)
  })
})

describe("límites", () => {
  it("la semana ISO va de lunes a domingo, también en el cambio de año", () => {
    expect(fuelPeriodBounds({ kind: "week", year: 2026, week: 44 })).toEqual({ from: "2026-10-26", to: "2026-11-01" })
    expect(fuelPeriodBounds({ kind: "week", year: 2026, week: 1 })).toEqual({ from: "2025-12-29", to: "2026-01-04" })
    expect(isoWeekOf("2027-01-01")).toEqual({ year: 2026, week: 53 })
  })

  it("mes, trimestre y año terminan en su último día", () => {
    expect(fuelPeriodBounds({ kind: "month", year: 2028, month: 2 })).toEqual({ from: "2028-02-01", to: "2028-02-29" })
    expect(fuelPeriodBounds({ kind: "quarter", year: 2026, quarter: 4 })).toEqual({ from: "2026-10-01", to: "2026-12-31" })
    expect(fuelPeriodBounds({ kind: "year", year: 2026 })).toEqual({ from: "2026-01-01", to: "2026-12-31" })
  })

  it("se mueve al período anterior y siguiente cruzando el año", () => {
    expect(shiftFuelPeriod({ kind: "month", year: 2026, month: 1 }, -1)).toEqual({ kind: "month", year: 2025, month: 12 })
    expect(shiftFuelPeriod({ kind: "quarter", year: 2026, quarter: 1 }, -1)).toEqual({ kind: "quarter", year: 2025, quarter: 4 })
    expect(shiftFuelPeriod({ kind: "week", year: 2026, week: 1 }, -1)).toEqual({ kind: "week", year: 2025, week: 52 })
    expect(shiftFuelPeriod({ kind: "range", from: "2026-10-01", to: "2026-10-10" }, -1)).toEqual({ kind: "range", from: "2026-09-21", to: "2026-09-30" })
  })

  it("arma la historia de cinco meses que termina en el período", () => {
    expect(previousFuelPeriods(OCT, 5).map((p) => formatFuelPeriodToken(p))).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"])
  })
})

describe("describeFuelPeriod", () => {
  it("el mes en curso no tiene siguiente y dice cuándo cierra", () => {
    const r = describeFuelPeriod(OCT, "url", TODAY)
    expect(r).toMatchObject({ label: "Octubre 2026", inLabel: "octubre", status: "en_curso", dueDate: "2026-10-31", next: null, isWholeMonths: true })
    expect(r.prev).toEqual({ kind: "month", year: 2026, month: 9 })
  })

  it("un mes pasado está cerrado y tiene siguiente", () => {
    const r = describeFuelPeriod({ kind: "month", year: 2026, month: 9 }, "url", TODAY)
    expect(r.status).toBe("cerrado")
    expect(r.next).toEqual(OCT)
  })

  it("rotula semana, trimestre, año y rango", () => {
    expect(describeFuelPeriod({ kind: "week", year: 2026, week: 44 }, "url", TODAY).label).toBe("Semana del 26 oct")
    expect(describeFuelPeriod({ kind: "quarter", year: 2026, quarter: 3 }, "url", TODAY).label).toBe("3.er trimestre 2026")
    expect(describeFuelPeriod({ kind: "quarter", year: 2026, quarter: 4 }, "url", TODAY).label).toBe("4.º trimestre 2026")
    expect(describeFuelPeriod({ kind: "year", year: 2026 }, "url", TODAY).label).toBe("Año 2026")
    expect(describeFuelPeriod({ kind: "range", from: "2026-09-15", to: "2026-10-15" }, "url", TODAY).label).toBe("15 sep – 15 oct")
    expect(describeFuelPeriod({ kind: "month", year: 2025, month: 10 }, "url", TODAY).inLabel).toBe("octubre de 2025")
  })

  it("lista los meses que toca una semana que cruza el mes", () => {
    expect(describeFuelPeriod({ kind: "week", year: 2026, week: 44 }, "url", TODAY).monthKeys).toEqual(["2026-10", "2026-11"])
  })
})

describe("resolveFuelPeriod", () => {
  const fallback = OCT
  it("periodo gana a todo lo demás", () => {
    const r = resolveFuelPeriod({ searchParams: { periodo: "2026-T3", desde: "2026-01-01", anio: "2025" }, cookieValue: "2024", fallback, today: TODAY })
    expect(r).toMatchObject({ token: "2026-T3", source: "url" })
  })

  it("desde/hasta es un rango, se ordena y se acota a dos años", () => {
    expect(resolveFuelPeriod({ searchParams: { desde: "2026-10-15", hasta: "2026-09-15" }, fallback, today: TODAY }).period)
      .toEqual({ kind: "range", from: "2026-09-15", to: "2026-10-15" })
    const long = resolveFuelPeriod({ searchParams: { desde: "2020-01-01", hasta: "2026-10-30" }, fallback, today: TODAY })
    expect(long.from).toBe("2024-10-29")
  })

  it("traduce los filtros antiguos y marca la fuente", () => {
    expect(resolveFuelPeriod({ searchParams: { anio: "2026", meses: "7,8,9" }, fallback, today: TODAY })).toMatchObject({ token: "2026-T3", source: "legacy" })
    expect(resolveFuelPeriod({ searchParams: { anio: "2026", meses: "10" }, fallback, today: TODAY }).token).toBe("2026-10")
    expect(resolveFuelPeriod({ searchParams: { anio: "2026" }, fallback, today: TODAY }).token).toBe("2026")
    expect(resolveFuelPeriod({ searchParams: { month: "2026-08" }, fallback, today: TODAY }).token).toBe("2026-08")
    expect(resolveFuelPeriod({ searchParams: { from: "2026-10-01", to: "2026-10-10" }, fallback, today: TODAY }).period)
      .toEqual({ kind: "range", from: "2026-10-01", to: "2026-10-10" })
    expect(resolveFuelPeriod({ searchParams: { startDate: "2026-10-01", endDate: "2026-10-10" }, fallback, today: TODAY }).source).toBe("legacy")
    expect(legacyFuelPeriodFromParams({ anio: "2026", meses: "1,5" })).toEqual({ kind: "range", from: "2026-01-01", to: "2026-05-31" })
  })

  it("sin URL usa la cookie, y sin cookie el valor por rol", () => {
    expect(resolveFuelPeriod({ searchParams: {}, cookieValue: "2026-09", fallback, today: TODAY })).toMatchObject({ token: "2026-09", source: "cookie" })
    expect(resolveFuelPeriod({ searchParams: {}, cookieValue: "basura", fallback, today: TODAY })).toMatchObject({ token: "2026-10", source: "default" })
  })

  it("acepta URLSearchParams y arreglos", () => {
    expect(resolveFuelPeriod({ searchParams: new URLSearchParams("periodo=2026-S44"), fallback, today: TODAY }).token).toBe("2026-S44")
    expect(resolveFuelPeriod({ searchParams: { periodo: ["2026-09", "2026-08"] }, fallback, today: TODAY }).token).toBe("2026-09")
  })
})

describe("valor por rol y accesos rápidos", () => {
  it("terreno abre en la semana; quien decide, en el mes", () => {
    const field = { user: { permissions: ["combustibles:view", "combustibles:register_load"] } }
    const boss = { user: { permissions: ["combustibles:register_load", "combustibles:approve_flagged"] } }
    expect(defaultFuelPeriodFor(field, TODAY)).toEqual({ kind: "week", year: 2026, week: 44 })
    expect(defaultFuelPeriodFor(boss, TODAY)).toEqual(OCT)
    expect(defaultFuelPeriodFor(null, TODAY)).toEqual(OCT)
  })

  it("ofrece los seis accesos rápidos del prototipo", () => {
    expect(fuelPeriodPresets(TODAY).map((p) => [p.label, formatFuelPeriodCookie(p.period)])).toEqual([
      ["Esta semana", "2026-S44"],
      ["Este mes", "2026-10"],
      ["Mes anterior", "2026-09"],
      ["Este trimestre", "2026-T4"],
      ["Trimestre anterior", "2026-T3"],
      ["Este año", "2026"],
    ])
    expect(currentMonthPeriod("2027-01-01")).toEqual({ kind: "month", year: 2027, month: 1 })
  })
})

describe("adaptadores", () => {
  it("el control recibe meses o rango", () => {
    expect(toControlPeriod(describeFuelPeriod({ kind: "quarter", year: 2026, quarter: 3 }, "url", TODAY))).toEqual({ year: 2026, months: [7, 8, 9], from: null, to: null })
    expect(toControlPeriod(describeFuelPeriod({ kind: "week", year: 2026, week: 44 }, "url", TODAY)))
      .toEqual({ year: 2026, months: [], from: "2026-10-26", to: "2026-11-01" })
  })

  it("facturas reciben el mes exacto o un rango", () => {
    expect(toInvoiceFilters(describeFuelPeriod(OCT, "url", TODAY))).toEqual({ month: "2026-10" })
    expect(toInvoiceFilters(describeFuelPeriod({ kind: "year", year: 2026 }, "url", TODAY))).toEqual({ startDate: "2026-01-01", endDate: "2026-12-31" })
  })

  it("los instantes usan la hora de Chile, también en el cambio de horario", () => {
    // El 6 de septiembre de 2026 Chile pasa de -04 a -03.
    const range = toChileInstantRange(describeFuelPeriod({ kind: "range", from: "2026-09-01", to: "2026-09-30" }, "url", TODAY))
    expect(range.start).toBe("2026-09-01T04:00:00.000Z")
    expect(range.endExclusive).toBe("2026-10-01T03:00:00.000Z")
  })

  it("avisa la granularidad mensual de las tarjetas sólo cuando hace falta", () => {
    expect(monthlyGranularityNote(describeFuelPeriod(OCT, "url", TODAY))).toBeNull()
    expect(monthlyGranularityNote(describeFuelPeriod({ kind: "week", year: 2026, week: 44 }, "url", TODAY))).toMatch(/2 meses completos/)
  })
})

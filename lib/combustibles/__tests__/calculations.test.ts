import { describe, it, expect } from "vitest"
import {
  calculateFuelAmounts,
  calculateStatementTotals,
  describeStatementStatus,
  fuelMonthLabel,
  getStatementDisplayStatus,
  statementPendingAmount,
} from "../calculations"

describe("calculateFuelAmounts", () => {
  it("calculates with both IEC rates configured", () => {
    const result = calculateFuelAmounts({
      liters: 1000,
      baseAmount: 1_000_000,
      iecFixedRate: 104.67,
      iecVariableRate: 82.07,
    })
    expect(result.iecFixed).toBe(104_670)
    expect(result.iecVariable).toBe(82_070)
    expect(result.iecTotal).toBe(186_740)
    expect(result.ivaAmount).toBe(190_000)
    expect(result.totalAmount).toBe(1_376_740)
  })

  it("returns 0 for IEC when rates are null", () => {
    const result = calculateFuelAmounts({
      liters: 500,
      baseAmount: 500_000,
      iecFixedRate: null,
      iecVariableRate: null,
    })
    expect(result.iecFixed).toBe(0)
    expect(result.iecVariable).toBe(0)
    expect(result.iecTotal).toBe(0)
    expect(result.ivaAmount).toBe(95_000)
    expect(result.totalAmount).toBe(595_000)
  })

  it("handles zero liters", () => {
    const result = calculateFuelAmounts({
      liters: 0,
      baseAmount: 0,
      iecFixedRate: 104.67,
      iecVariableRate: 82.07,
    })
    expect(result.iecFixed).toBe(0)
    expect(result.iecVariable).toBe(0)
    expect(result.totalAmount).toBe(0)
  })

  it("handles custom IVA rate", () => {
    const result = calculateFuelAmounts({
      liters: 100,
      baseAmount: 100_000,
      iecFixedRate: null,
      iecVariableRate: null,
      ivaRate: 0.10,
    })
    expect(result.ivaAmount).toBe(10_000)
    expect(result.totalAmount).toBe(110_000)
  })

  it("rounds to 2 decimal places", () => {
    const result = calculateFuelAmounts({
      liters: 333.333,
      baseAmount: 333_333.33,
      iecFixedRate: 100.555,
      iecVariableRate: null,
    })
    expect(result.iecFixed).toBeCloseTo(33_518.3, 1)
  })
})

describe("calculateStatementTotals", () => {
  it("sums multiple loads correctly", () => {
    const loads = [
      { liters: 1000, baseAmount: 1_000_000, iecTotal: 186_740, ivaAmount: 190_000, totalAmount: 1_376_740 },
      { liters: 500, baseAmount: 500_000, iecTotal: 93_370, ivaAmount: 95_000, totalAmount: 688_370 },
    ]
    const result = calculateStatementTotals(loads)
    expect(result.totalLiters).toBe(1500)
    expect(result.totalBaseAmount).toBe(1_500_000)
    expect(result.totalIec).toBe(280_110)
    expect(result.totalIva).toBe(285_000)
    expect(result.totalAmount).toBe(2_065_110)
  })

  it("returns zeros for empty array", () => {
    const result = calculateStatementTotals([])
    expect(result.totalLiters).toBe(0)
    expect(result.totalAmount).toBe(0)
  })
})

describe("fuelMonthLabel", () => {
  it("dice el mes en palabras, en español y con mayúscula", () => {
    expect(fuelMonthLabel("2026-09")).toBe("Septiembre 2026")
    expect(fuelMonthLabel("2026-01")).toBe("Enero 2026")
    expect(fuelMonthLabel("2026-12")).toBe("Diciembre 2026")
  })

  it("devuelve tal cual lo que no es un mes, en vez de inventar uno", () => {
    expect(fuelMonthLabel("septiembre")).toBe("septiembre")
    expect(fuelMonthLabel("2026-13")).toBe("2026-13")
  })
})

describe("statementPendingAmount", () => {
  it("es lo que falta por pagar y nunca baja de cero", () => {
    expect(statementPendingAmount({ totalAmount: 1_000, paidAmount: 400 })).toBe(600)
    expect(statementPendingAmount({ totalAmount: 1_000, paidAmount: 1_000 })).toBe(0)
    expect(statementPendingAmount({ totalAmount: 1_000, paidAmount: 1_500 })).toBe(0)
  })

  it("no arrastra el ruido de los decimales", () => {
    expect(statementPendingAmount({ totalAmount: 0.3, paidAmount: 0.1 })).toBe(0.2)
  })
})

describe("describeStatementStatus: el estado de cuenta dicho en una frase", () => {
  const today = "2026-10-20"
  const base = { status: "open", dueDate: "2026-11-05", totalAmount: 14_230_000, paidAmount: 0 }

  it("sin pagos: lo que se debe y cuándo vence, en fecha legible", () => {
    const text = describeStatementStatus(base, today)
    expect(text).toMatch(/^Sin pagos registrados\./)
    expect(text).toContain("05-11-2026")
    expect(text).toContain("en 16 días")
    expect(text).not.toMatch(/\bopen\b/)
  })

  it("con pago parcial: cuánto se pagó, cuánto falta y para cuándo", () => {
    const text = describeStatementStatus({ ...base, status: "partial", paidAmount: 5_830_000 }, today)
    expect(text).toMatch(/^Se pagó el 41/)
    expect(text).toContain("05-11-2026")
    expect(getStatementDisplayStatus({ ...base, status: "partial", paidAmount: 5_830_000 }, today)).toBe("partial")
  })

  it("vencido: dice desde cuándo y cuánto falta, aunque la fila siga guardada como abierta", () => {
    const text = describeStatementStatus({ ...base, dueDate: "2026-10-10", paidAmount: 4_000_000 }, today)
    expect(text).toMatch(/^Venció el 10-10-2026 \(hace 10 días\)/)
    expect(getStatementDisplayStatus({ ...base, dueDate: "2026-10-10" }, today)).toBe("overdue")
  })

  it("pagado y anulado no hablan de fechas", () => {
    expect(describeStatementStatus({ ...base, status: "paid", paidAmount: 14_230_000 }, today)).toMatch(/^Pagado por completo/)
    expect(describeStatementStatus({ ...base, status: "cancelled" }, today)).toBe("Este estado de cuenta está anulado.")
  })

  it("sin fecha de vencimiento lo dice, en vez de dejar un hueco", () => {
    expect(describeStatementStatus({ ...base, dueDate: null }, today)).toContain("sin fecha de vencimiento")
  })
})

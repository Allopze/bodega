import { describe, expect, it } from "vitest"
import { STAT_MISSING } from "../contracts"
import { formatStat, mean, sampleStdDev } from "./statistics"
import { reconcile } from "./reconciliation"
import { idlePct, telemetryLitersPerHour } from "./idle"

describe("estadística muestral", () => {
  it("un solo registro: media existe, σ no («—»)", () => {
    expect(mean([7])).toBe(7)
    expect(sampleStdDev([7])).toBeNull()
    expect(formatStat(sampleStdDev([7]))).toBe(STAT_MISSING)
  })

  it("sin datos: media y σ nulas", () => {
    expect(mean([])).toBeNull()
    expect(sampleStdDev([])).toBeNull()
  })

  it("n = 2: σ muestral exacta (÷ n−1)", () => {
    // |a−b|/√2 → 2/√2 = √2
    expect(sampleStdDev([10, 12])).toBeCloseTo(Math.SQRT2, 12)
  })

  it("σ muestral de una serie conocida", () => {
    // Var muestral de 2,4,4,4,5,5,7,9 = 32/7
    expect(sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12)
  })

  it("formatStat usa formato es-CL", () => {
    expect(formatStat(1234.567, 2)).toBe("1.234,57")
    expect(formatStat(null)).toBe(STAT_MISSING)
    expect(formatStat(Number.NaN)).toBe(STAT_MISSING)
  })
})

describe("conciliación por mandante", () => {
  it("sin entrada ni entregas: sin porcentaje ni juicio", () => {
    expect(reconcile({ inputLiters: 0, directLiters: 0, viaTankLiters: 0, tolerancePct: 2 }))
      .toEqual({ deliveredLiters: 0, differenceLiters: 0, differencePct: null, withinTolerance: null })
  })

  it("sin entrada pero con entregas: fuera de tolerancia", () => {
    expect(reconcile({ inputLiters: 0, directLiters: 10, viaTankLiters: 0, tolerancePct: 2 }).withinTolerance).toBe(false)
  })

  it("dentro de tolerancia", () => {
    const result = reconcile({ inputLiters: 1000, directLiters: 600, viaTankLiters: 385, tolerancePct: 2 })
    expect(result).toMatchObject({ deliveredLiters: 985, differenceLiters: 15, withinTolerance: true })
    expect(result.differencePct).toBeCloseTo(1.5, 10)
  })

  it("sobre tolerancia", () => {
    const result = reconcile({ inputLiters: 1000, directLiters: 900, viaTankLiters: 50, tolerancePct: 2 })
    expect(result.differencePct).toBeCloseTo(5, 10)
    expect(result.withinTolerance).toBe(false)
  })

  it("diferencia negativa (se entregó más de lo que entró) cuenta por su valor absoluto", () => {
    const over = reconcile({ inputLiters: 1000, directLiters: 1030, viaTankLiters: 0, tolerancePct: 2 })
    expect(over.differenceLiters).toBe(-30)
    expect(over.differencePct).toBeCloseTo(-3, 10)
    expect(over.withinTolerance).toBe(false)
    const small = reconcile({ inputLiters: 1000, directLiters: 1010, viaTankLiters: 0, tolerancePct: 2 })
    expect(small.withinTolerance).toBe(true)
  })
})

describe("ralentí", () => {
  it("sin horas de funcionamiento no hay porcentaje", () => {
    expect(idlePct(3, 0)).toBeNull()
    expect(telemetryLitersPerHour(100, 10, 0)).toBeNull()
  })

  it("% vacío desde horas crudas", () => {
    expect(idlePct(2, 8)).toBe(25)
    expect(telemetryLitersPerHour(90, 10, 5)).toBe(20)
    expect(telemetryLitersPerHour(null, null, 5)).toBeNull()
  })
})

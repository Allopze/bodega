/**
 * CHART-035b · saldo de un producto en una faena a lo largo del tiempo.
 *
 * Las cifras salen del efecto real de cada movimiento (`stockAfter - stockBefore`),
 * no de su tipo ni de su signo: `egreso_desecho` se guarda con signo negativo,
 * `egreso_entrega` depende del flujo y `retiro_epp_trabajador` no mueve saldo.
 */
import { describe, expect, it } from "vitest"
import {
  balanceSummary,
  balanceTable,
  chooseGranularity,
  shapeBalanceSeries,
  type BalanceMovement,
} from "../balance-series"

const move = (performedAt: string, stockBefore: number, stockAfter: number): BalanceMovement => ({ performedAt, stockBefore, stockAfter })

describe("chooseGranularity", () => {
  it("día hasta ~3 meses, semana hasta ~13 y mes después", () => {
    expect(chooseGranularity(30)).toBe("day")
    expect(chooseGranularity(92)).toBe("day")
    expect(chooseGranularity(93)).toBe("week")
    expect(chooseGranularity(400)).toBe("week")
    expect(chooseGranularity(401)).toBe("month")
  })
})

describe("shapeBalanceSeries · por día", () => {
  const movements = [
    move("2026-10-01T15:00:00.000Z", 0, 100),
    move("2026-10-03T15:00:00.000Z", 100, 60),
    move("2026-10-03T18:00:00.000Z", 60, 50),
    move("2026-10-05T15:00:00.000Z", 50, 80),
  ]

  it("una entrada por día de la ventana, con el saldo arrastrado donde no hubo movimientos", () => {
    const series = shapeBalanceSeries(movements, { from: "2026-10-01", to: "2026-10-06", today: "2026-10-06" })!
    expect(series.granularity).toBe("day")
    expect(series.buckets.map((bucket) => bucket.start)).toEqual([
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06",
    ])
    expect(series.buckets.map((bucket) => bucket.balance)).toEqual([100, 100, 50, 50, 80, 80])
    expect(series.buckets.map((bucket) => bucket.ingress)).toEqual([100, 0, 0, 0, 30, 0])
    expect(series.buckets.map((bucket) => bucket.egress)).toEqual([0, 0, 50, 0, 0, 0])
  })

  it("el saldo inicial es el anterior al primer movimiento y el final el del último día", () => {
    const series = shapeBalanceSeries(movements, { from: "2026-10-01", to: "2026-10-06", today: "2026-10-06" })!
    expect(series.opening).toBe(0)
    expect(series.closing).toBe(80)
    expect(series.ingress).toBe(130)
    expect(series.egress).toBe(50)
    expect(series.movements).toBe(4)
  })

  it("antes del primer movimiento de la ventana el saldo es el que ya había", () => {
    const series = shapeBalanceSeries([move("2026-10-05T15:00:00.000Z", 40, 25)], { from: "2026-10-01", to: "2026-10-06", today: "2026-10-06" })!
    expect(series.buckets.map((bucket) => bucket.balance)).toEqual([40, 40, 40, 40, 25, 25])
    expect(series.opening).toBe(40)
  })

  it("el día es el civil de Chile: las 23:30 de Chile del 2 ya son 3 en UTC", () => {
    const series = shapeBalanceSeries([move("2026-10-03T02:30:00.000Z", 10, 7)], { from: "2026-10-01", to: "2026-10-03", today: "2026-10-03" })!
    expect(series.buckets.find((bucket) => bucket.egress > 0)?.start).toBe("2026-10-02")
  })

  it("retirar EPP usado no mueve saldo: cuenta como movimiento pero no suma ni resta", () => {
    const series = shapeBalanceSeries([move("2026-10-02T15:00:00.000Z", 10, 10)], { from: "2026-10-01", to: "2026-10-03", today: "2026-10-03" })!
    expect(series.ingress).toBe(0)
    expect(series.egress).toBe(0)
    expect(series.movements).toBe(1)
    expect(series.buckets.map((bucket) => bucket.balance)).toEqual([10, 10, 10])
  })

  it("sin movimientos en la ventana no hay serie (el gráfico explica el vacío)", () => {
    expect(shapeBalanceSeries([], { from: "2026-10-01", to: "2026-10-03" })).toBeNull()
    expect(shapeBalanceSeries([move("2026-09-01T15:00:00.000Z", 0, 5)], { from: "2026-10-01", to: "2026-10-03" })).toBeNull()
  })

  it("una ventana al revés no inventa una serie", () => {
    expect(shapeBalanceSeries([move("2026-10-02T15:00:00.000Z", 0, 5)], { from: "2026-10-05", to: "2026-10-01" })).toBeNull()
  })

  it("el orden de llegada no importa", () => {
    const shuffled = [...movements].reverse()
    const series = shapeBalanceSeries(shuffled, { from: "2026-10-01", to: "2026-10-06", today: "2026-10-06" })!
    expect(series.closing).toBe(80)
    expect(series.opening).toBe(0)
  })
})

describe("shapeBalanceSeries · por semana y por mes", () => {
  it("con más de ~3 meses agrupa por semana (lunes a domingo) y marca la que sigue en curso", () => {
    const series = shapeBalanceSeries(
      [move("2026-07-02T15:00:00.000Z", 0, 50), move("2026-11-03T15:00:00.000Z", 50, 20)],
      { from: "2026-07-01", to: "2026-11-03", today: "2026-11-03" },
    )!
    expect(series.granularity).toBe("week")
    expect(series.buckets[0]!.start).toBe("2026-06-29")
    const last = series.buckets.at(-1)!
    expect(last.start).toBe("2026-11-02")
    expect(last.partial).toBe(true)
    expect(series.buckets.slice(0, -1).every((bucket) => !bucket.partial)).toBe(true)
    expect(last.balance).toBe(20)
  })

  it("con más de un año agrupa por mes", () => {
    const series = shapeBalanceSeries(
      [move("2025-01-15T15:00:00.000Z", 0, 10), move("2026-11-03T15:00:00.000Z", 10, 4)],
      { from: "2025-01-01", to: "2026-11-03", today: "2026-11-03" },
    )!
    expect(series.granularity).toBe("month")
    expect(series.buckets[0]!.start).toBe("2025-01-01")
    expect(series.buckets.at(-1)!.start).toBe("2026-11-01")
    expect(series.buckets.at(-1)!.partial).toBe(true)
  })

  it("por día nada se marca parcial: el día en curso se lee como cualquier otro", () => {
    const series = shapeBalanceSeries([move("2026-11-03T15:00:00.000Z", 5, 9)], { from: "2026-10-20", to: "2026-11-03", today: "2026-11-03" })!
    expect(series.buckets.every((bucket) => !bucket.partial)).toBe(true)
  })
})

describe("balanceSummary y balanceTable", () => {
  const series = shapeBalanceSeries(
    [move("2026-10-01T15:00:00.000Z", 0, 100), move("2026-10-03T15:00:00.000Z", 100, 40)],
    { from: "2026-10-01", to: "2026-10-06", today: "2026-10-06" },
  )!

  it("dice de dónde a dónde pasó el saldo y cuánto entró y salió", () => {
    expect(balanceSummary(series, { productName: "Guante", worksiteName: "Cholguán", unit: "par" })).toBe(
      "Saldo de «Guante» en Cholguán: pasó de 0 a 40 pares entre el 01-10-2026 y el 06-10-2026. Ingresaron 100 pares y salieron 60 pares.",
    )
  })

  it("si el saldo termina donde empezó no dice que «pasó» de uno a otro", () => {
    const flat = shapeBalanceSeries(
      [move("2026-10-01T15:00:00.000Z", 10, 20), move("2026-10-02T15:00:00.000Z", 20, 10)],
      { from: "2026-10-01", to: "2026-10-03", today: "2026-10-03" },
    )!
    const text = balanceSummary(flat, { productName: "Guante", worksiteName: "Cholguán", unit: "par" })
    expect(text).toContain("terminó en el mismo saldo que al empezar (10 pares)")
    expect(text).not.toContain("pasó de")
  })

  it("«Ver datos» lista sólo los períodos con movimientos, con el saldo al cierre", () => {
    const table = balanceTable(series)
    expect(table.headers).toEqual(["Período", "Ingresos", "Egresos", "Saldo al cierre"])
    expect(table.rows).toEqual([
      ["01-10-2026", "100", "0", "100"],
      ["03-10-2026", "0", "60", "40"],
    ])
  })
})

import { describe, expect, it } from "vitest"
import { buildMonthlyTrend, monthlyTrendWindow } from "@/lib/services/analytics-module/helpers"

/**
 * C-10 (AUDITORIA_VISUALIZACIONES_CHOME.md, Anexo C): con la ventana por defecto
 * de 30 días la «Tendencia mensual de gasto» era un solo punto (o dos). Una serie
 * mensual necesita meses: la ventana es siempre de 12 meses civiles que terminan
 * en el mes de `hasta`, y no depende de `desde`.
 */
describe("monthlyTrendWindow", () => {
  it("son 12 meses civiles que terminan en el mes de `hasta`", () => {
    expect(monthlyTrendWindow("2026-10-20")).toEqual({
      fromDate: "2025-11-01",
      toDate: "2026-10-20",
      months: ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
    })
  })

  it("cruza el año sin saltarse ni repetir meses", () => {
    const window = monthlyTrendWindow("2026-01-31")
    expect(window.fromDate).toBe("2025-02-01")
    expect(window.months).toHaveLength(12)
    expect(window.months[0]).toBe("2025-02")
    expect(window.months.at(-1)).toBe("2026-01")
  })

  it("diciembre arranca en enero del mismo año", () => {
    const window = monthlyTrendWindow("2026-12-15")
    expect(window.fromDate).toBe("2026-01-01")
    expect(window.months[0]).toBe("2026-01")
  })
})

describe("buildMonthlyTrend", () => {
  const empty = { purchasingAmount: 0, fuelAmount: 0, totalAmount: 0 }

  it("rellena con ceros los meses sin movimiento: el eje es continuo", () => {
    const rows = buildMonthlyTrend(
      [{ month: "2026-08", purchasingAmount: 100, fuelAmount: 50, totalAmount: 150 }],
      "2026-10-31",
      "2026-11-03",
    )

    expect(rows.map((row) => row.month)).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ])
    expect(rows.find((row) => row.month === "2026-08")).toMatchObject({ purchasingAmount: 100, fuelAmount: 50, totalAmount: 150 })
    expect(rows.find((row) => row.month === "2026-09")).toMatchObject(empty)
  })

  it("C-4: los meses sin datos del proveedor llevan combustible null; las compras siguen en cero", () => {
    const rows = buildMonthlyTrend(
      [{ month: "2026-08", purchasingAmount: 100, fuelAmount: 50, totalAmount: 150 }, { month: "2026-09", purchasingAmount: 70, fuelAmount: 0, totalAmount: 70 }],
      "2026-10-31",
      "2026-11-03",
      new Set(["2026-09", "2025-11"]),
    )

    // Un hueco no pisa lo comprado, y conserva su total (sólo compras): el combustible no vale cero, no se conoce.
    expect(rows.find((row) => row.month === "2026-09")).toMatchObject({ purchasingAmount: 70, fuelAmount: null, totalAmount: 70 })
    expect(rows.find((row) => row.month === "2025-11")).toMatchObject({ purchasingAmount: 0, fuelAmount: null, totalAmount: 0 })
    // Un mes fuera del conjunto de huecos mantiene su cifra, y uno sin movimiento y sin hueco es un cero real.
    expect(rows.find((row) => row.month === "2026-08")).toMatchObject({ fuelAmount: 50 })
    expect(rows.find((row) => row.month === "2026-07")).toMatchObject({ fuelAmount: 0 })
  })

  it("sin conjunto de huecos nada cambia: todo mes sin movimiento es un cero", () => {
    expect(buildMonthlyTrend([], "2026-10-31", "2026-11-03").every((row) => row.fuelAmount === 0)).toBe(true)
  })

  it("descarta meses fuera de la ventana", () => {
    const rows = buildMonthlyTrend(
      [{ month: "2020-01", purchasingAmount: 1, fuelAmount: 1, totalAmount: 2 }],
      "2026-10-31",
      "2026-11-03",
    )
    expect(rows.some((row) => row.month === "2020-01")).toBe(false)
    expect(rows).toHaveLength(12)
  })

  it("marca parcial el mes de `hasta` si el día elegido no es el último del mes", () => {
    const rows = buildMonthlyTrend([], "2026-10-20", "2026-11-03")
    expect(rows.at(-1)).toMatchObject({ month: "2026-10", partial: true })
    expect(rows.slice(0, -1).every((row) => row.partial === false)).toBe(true)
  })

  it("el último día del mes cierra el mes: no es parcial", () => {
    const rows = buildMonthlyTrend([], "2026-10-31", "2026-11-03")
    expect(rows.every((row) => row.partial === false)).toBe(true)
  })

  it("el mes en curso es parcial aunque `hasta` apunte al fin de mes (hoy no ha terminado)", () => {
    const rows = buildMonthlyTrend([], "2026-11-30", "2026-11-03")
    expect(rows.at(-1)).toMatchObject({ month: "2026-11", partial: true })
  })

  it("un `hasta` en febrero bisiesto cierra el 29", () => {
    expect(buildMonthlyTrend([], "2028-02-28", "2028-03-05").at(-1)?.partial).toBe(true)
    expect(buildMonthlyTrend([], "2028-02-29", "2028-03-05").at(-1)?.partial).toBe(false)
  })
})

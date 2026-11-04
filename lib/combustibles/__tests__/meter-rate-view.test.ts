import { describe, expect, it } from "vitest"
import type { MeterRateMonth, MeterRateSeries } from "../meter-rate-series"
import { meterRateChartData, meterRateNotes, meterRateTable, monthCaption, rateAxisDomain } from "../meter-rate-view"

const month = (overrides: Partial<MeterRateMonth> & { month: string }): MeterRateMonth => ({
  measure: 400, liters: 160, segments: 4, equipment: 2, discarded: 0, rate: 2.5, status: "ok", partial: false, ...overrides,
})

const series = (months: MeterRateMonth[], overrides: Partial<MeterRateSeries> = {}): MeterRateSeries => ({
  unit: "km_per_liter", months, rate: 2.5, measure: 800, liters: 320, segments: 8, equipment: 2, discarded: 0, readings: 12, status: "ok", ...overrides,
})

describe("monthCaption", () => {
  it("bajo cada mes va su n, o por qué no hay rendimiento: nunca un cero", () => {
    expect(monthCaption(month({ month: "2026-03", segments: 4 }))).toBe("n=4")
    expect(monthCaption(month({ month: "2026-04", status: "insufficient", segments: 2, rate: null }))).toBe("n=2")
    expect(monthCaption(month({ month: "2026-05", status: "gap", segments: 0, rate: null }))).toBe("sin datos")
  })
})

describe("meterRateChartData", () => {
  it("una fila por mes, con el rendimiento nulo donde no hay (el hueco corta la línea) y el índice del primer mes parcial", () => {
    const { data, partialFrom } = meterRateChartData(series([
      month({ month: "2026-08" }),
      month({ month: "2026-09", status: "gap", rate: null, segments: 0, measure: 0, liters: 0, equipment: 0 }),
      month({ month: "2026-10", partial: true, rate: 2.1 }),
    ]))

    expect(data.map((row) => row.rate)).toEqual([2.5, null, 2.1])
    expect(data.map((row) => row.label)).toEqual(["Ago 26", "Sep 26", "Oct 26"])
    expect(data[2]!.fullLabel).toBe("Octubre 2026 (en curso)")
    expect(data[1]!.fullLabel).toBe("Septiembre 2026")
    expect(partialFrom).toBe(2)
  })

  it("sin mes parcial el índice es −1", () => {
    expect(meterRateChartData(series([month({ month: "2026-08" })])).partialFrom).toBe(-1)
  })
})

describe("rateAxisDomain", () => {
  it("encierra la serie y la banda de ±10 % del global, con aire, sin bajar de 0", () => {
    const [low, high] = rateAxisDomain([2.4, 2.6, 2.5], 2.5)

    expect(low).toBeLessThanOrEqual(2.25)
    expect(high).toBeGreaterThanOrEqual(2.75)
    expect(low).toBeGreaterThanOrEqual(0)
  })

  it("con un solo punto igual deja un dominio que no es plano", () => {
    const [low, high] = rateAxisDomain([3], null)

    expect(high).toBeGreaterThan(low)
  })

  it("sin ningún valor devuelve un dominio por defecto en lugar de NaN", () => {
    const [low, high] = rateAxisDomain([], null)

    expect(Number.isFinite(low) && Number.isFinite(high)).toBe(true)
    expect(high).toBeGreaterThan(low)
  })
})

describe("meterRateTable", () => {
  it("«Ver datos» trae el mismo estado que el gráfico: rendimiento, n, equipos, medidor, litros y qué pasó con el mes", () => {
    const { headers, rows } = meterRateTable(series([
      month({ month: "2026-08" }),
      month({ month: "2026-09", status: "gap", rate: null, segments: 0, measure: 0, liters: 0, equipment: 0 }),
      month({ month: "2026-10", status: "insufficient", rate: null, segments: 2, measure: 200, liters: 80, equipment: 1, partial: true }),
      month({ month: "2026-11", discarded: 3 }),
    ]))

    expect(headers).toEqual(["Mes", "Rendimiento (km/L)", "Tramos (n)", "Equipos", "Kilómetros", "Litros", "Observación"])
    expect(rows[0]).toEqual(["Ago 2026", "2,5", "4", "2", "400", "160", "—"])
    expect(rows[1]).toEqual(["Sep 2026", "—", "—", "—", "—", "—", "Sin datos del proveedor"])
    expect(rows[2]).toEqual(["Oct 2026", "—", "2", "1", "200", "80", "Datos insuficientes · mes en curso"])
    expect(rows[3]![6]).toBe("3 pares descartados")
  })

  it("en L/h las columnas hablan de horas", () => {
    const { headers } = meterRateTable(series([month({ month: "2026-08" })], { unit: "liters_per_hour" }))

    expect(headers[1]).toBe("Rendimiento (L/h)")
    expect(headers[4]).toBe("Horas")
  })
})

describe("meterRateNotes", () => {
  it("cuenta los meses en blanco y los descartes, y dice qué es n", () => {
    const notes = meterRateNotes(series([
      month({ month: "2026-08", discarded: 2 }),
      month({ month: "2026-09", status: "gap", rate: null, segments: 0 }),
      month({ month: "2026-10", status: "insufficient", rate: null, segments: 1, discarded: 1 }),
    ]))

    expect(notes.join(" ")).toContain("n = tramos")
    expect(notes.join(" ")).toContain("1 mes sin datos del proveedor")
    expect(notes.join(" ")).toContain("1 mes con datos insuficientes")
    expect(notes.join(" ")).toContain("3 pares de lecturas descartados")
  })

  it("sin huecos ni descartes no inventa avisos, pero sí aclara que sólo cuenta lo cargado con tarjeta Copec", () => {
    const notes = meterRateNotes(series([month({ month: "2026-08" })]))

    expect(notes.join(" ")).not.toContain("sin datos del proveedor")
    expect(notes.join(" ")).not.toContain("descartados")
    expect(notes.join(" ")).toContain("tarjeta Copec")
  })
})

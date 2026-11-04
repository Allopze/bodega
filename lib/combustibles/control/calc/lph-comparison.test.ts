import { describe, expect, it } from "vitest"
import type { LitersPerHourComparisonRow } from "../queries/idle-comparison"
import { LPH_BAND_PCT, buildLphComparison, describeLphComparison } from "./lph-comparison"

/**
 * CHART-021: telemetría contra cargas. Cada punto es un equipo en un mes; x = L/h que salen de las cargas, y = L/h que
 * mide la telemetría. Sobre la diagonal coinciden; fuera de la banda de ±15 % la discrepancia merece una mirada.
 */

const row = (overrides: Partial<LitersPerHourComparisonRow> & { vehicleId: string; month: string }): LitersPerHourComparisonRow => ({
  equipment: `${overrides.vehicleId.toUpperCase()} · PL-${overrides.vehicleId}`,
  telemetryLph: 10, loadsLph: 10, loadCount: 3, differencePct: 0, ...overrides,
})

describe("buildLphComparison", () => {
  it("sólo se dibujan los pares con ambos lados; el resto se cuenta aparte, no se inventa", () => {
    const view = buildLphComparison([
      row({ vehicleId: "a", month: "2026-03", telemetryLph: 12, loadsLph: 10, differencePct: 20 }),
      row({ vehicleId: "a", month: "2026-04", telemetryLph: 9, loadsLph: null, loadCount: 0, differencePct: null }),
      row({ vehicleId: "b", month: "2026-03", telemetryLph: null, loadsLph: 14, differencePct: null }),
    ])

    expect(view.points).toHaveLength(1)
    expect(view.points[0]).toMatchObject({ vehicleId: "a", month: "2026-03", x: 10, y: 12 })
    expect(view.noLoads).toBe(1)
    expect(view.noTelemetry).toBe(1)
  })

  it("marca fuera de la banda lo que se aleja más de ±15 % de las cargas, y lo ordena por la distancia", () => {
    const view = buildLphComparison([
      row({ vehicleId: "a", month: "2026-03", telemetryLph: 11, loadsLph: 10, differencePct: 10 }), // dentro
      row({ vehicleId: "b", month: "2026-03", telemetryLph: 15.1, loadsLph: 10, differencePct: 51 }), // fuera, mide más
      row({ vehicleId: "c", month: "2026-03", telemetryLph: 6, loadsLph: 10, differencePct: -40 }), // fuera, mide menos
      row({ vehicleId: "d", month: "2026-03", telemetryLph: 8.5, loadsLph: 10, differencePct: -15 }), // justo en el borde: dentro
    ])

    expect(LPH_BAND_PCT).toBe(15)
    expect(view.points.filter((point) => point.outside).map((point) => point.vehicleId)).toEqual(["b", "c"])
    expect(view.outside.map((point) => [point.vehicleId, point.direction])).toEqual([["b", "above"], ["c", "below"]])
  })

  it("la banda se calcula desde los L/h, no desde el % que viene en la fila", () => {
    // Una fila con el % mal puesto no cambia el veredicto: manda la geometría del gráfico.
    const view = buildLphComparison([row({ vehicleId: "a", month: "2026-03", telemetryLph: 14, loadsLph: 10, differencePct: 1 })])

    expect(view.points[0]!.outside).toBe(true)
    expect(view.points[0]!.differencePct).toBeCloseTo(40, 10)
  })

  it("cuenta los equipos distintos, no los pares", () => {
    const view = buildLphComparison([
      row({ vehicleId: "a", month: "2026-03" }),
      row({ vehicleId: "a", month: "2026-04" }),
      row({ vehicleId: "b", month: "2026-03" }),
    ])

    expect(view.points).toHaveLength(3)
    expect(view.equipmentCount).toBe(2)
  })

  it("los dos ejes comparten escala: el tope cubre al mayor de los dos lados, con aire", () => {
    const view = buildLphComparison([
      row({ vehicleId: "a", month: "2026-03", telemetryLph: 38, loadsLph: 12 }),
      row({ vehicleId: "b", month: "2026-03", telemetryLph: 7, loadsLph: 21 }),
    ])

    expect(view.axisMax).toBeGreaterThanOrEqual(38)
    expect(view.axisMax).toBeLessThanOrEqual(60)
  })

  it("una carga con 0 L/h declarados no es un par (la diagonal no admite dividir por cero)", () => {
    const view = buildLphComparison([row({ vehicleId: "a", month: "2026-03", telemetryLph: 5, loadsLph: 0 })])

    expect(view.points).toHaveLength(0)
    expect(view.noLoads).toBe(1)
  })
})

describe("describeLphComparison", () => {
  const view = (rows: LitersPerHourComparisonRow[]) => buildLphComparison(rows)

  it("dice cuántos pares caen fuera de la banda y en qué sentido", () => {
    const text = describeLphComparison(view([
      row({ vehicleId: "a", month: "2026-03" }),
      row({ vehicleId: "b", month: "2026-03", telemetryLph: 16, loadsLph: 10 }),
      row({ vehicleId: "c", month: "2026-03", telemetryLph: 5, loadsLph: 10 }),
      row({ vehicleId: "d", month: "2026-03", telemetryLph: 10.2, loadsLph: 10 }),
    ]))

    expect(text).toContain("4 pares equipo-mes")
    expect(text).toContain("2 quedan fuera de la banda de ±15 %")
    expect(text).toContain("1 mide más que lo cargado")
    expect(text).toContain("1 mide menos")
  })

  it("si todos coinciden lo dice sin inventar una discrepancia", () => {
    const text = describeLphComparison(view([row({ vehicleId: "a", month: "2026-03" }), row({ vehicleId: "b", month: "2026-03" })]))

    expect(text).toContain("Los 2 pares equipo-mes")
    expect(text).toContain("dentro de la banda de ±15 %")
    expect(text).not.toContain("fuera")
  })

  it("con un solo par habla en singular", () => {
    expect(describeLphComparison(view([row({ vehicleId: "a", month: "2026-03", telemetryLph: 20, loadsLph: 10 })]))).toContain("El par equipo-mes con telemetría y cargas queda fuera")
    expect(describeLphComparison(view([row({ vehicleId: "a", month: "2026-03" })]))).toContain("El par equipo-mes con telemetría y cargas está dentro")
  })

  it("sin pares no hay frase: el gráfico se reemplaza por su estado vacío", () => {
    expect(describeLphComparison(view([row({ vehicleId: "a", month: "2026-03", loadsLph: null })]))).toBeNull()
    expect(describeLphComparison(view([]))).toBeNull()
  })
})

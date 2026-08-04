import { describe, expect, it } from "vitest"
import { toSstMonthlyPoints } from "./sst-monthly-points"

/**
 * `provisional` es un superconjunto de `confirmed` (confirmados + pendientes).
 * El gráfico de accidentes graficaba las dos como si fueran clases de gravedad
 * ("CTP" y "STP"), así que la barra chica quedaba contenida en la grande y
 * ninguna tenía que ver con tiempo perdido. Estos casos fijan la partición real.
 */
const month = (confirmed: number, provisional: number, rates?: { tf?: number | null; tg?: number | null }) => ({
  confirmed: {
    accidents: confirmed,
    frequencyRate: rates?.tf ?? null,
    severityRate: rates?.tg ?? null,
  },
  provisional: { accidents: provisional },
})

describe("toSstMonthlyPoints", () => {
  it("parte el total provisional en confirmados y por calificar", () => {
    const [point] = toSstMonthlyPoints([month(3, 5)])
    expect(point!.confirmados).toBe(3)
    expect(point!.porCalificar).toBe(2)
    // La suma de los dos segmentos apilados tiene que ser el total provisional.
    expect(point!.confirmados + point!.porCalificar).toBe(5)
  })

  it("deja porCalificar en 0 cuando todo está confirmado", () => {
    const [point] = toSstMonthlyPoints([month(4, 4)])
    expect(point!.confirmados).toBe(4)
    expect(point!.porCalificar).toBe(0)
  })

  it("no emite negativos si provisional viene por debajo de confirmed", () => {
    // El motor garantiza provisional ⊇ confirmed; el tipo no. Si el invariante
    // se rompiera, una barra con alto negativo se dibuja hacia abajo.
    const [point] = toSstMonthlyPoints([month(5, 2)])
    expect(point!.porCalificar).toBe(0)
  })

  it("toma las tasas de confirmed y trata null como 0", () => {
    const [withRates, withoutRates] = toSstMonthlyPoints([
      month(1, 1, { tf: 12.5, tg: 340 }),
      month(0, 0),
    ])
    expect(withRates!.tasaFrecuencia).toBe(12.5)
    expect(withRates!.tasaGravedad).toBe(340)
    expect(withoutRates!.tasaFrecuencia).toBe(0)
    expect(withoutRates!.tasaGravedad).toBe(0)
  })

  it("rotula los meses en orden y aguanta series de menos de 12", () => {
    const points = toSstMonthlyPoints([month(0, 0), month(0, 0), month(0, 0)])
    expect(points.map((p) => p.month)).toEqual(["Ene", "Feb", "Mar"])
  })
})

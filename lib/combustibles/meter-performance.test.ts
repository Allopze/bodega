import { describe, expect, it } from "vitest"
import { summarizeMeterPerformance } from "./meter-performance"

const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T12:00:00.000Z`

describe("summarizeMeterPerformance", () => {
  it("promedia los tramos ponderando por litros", () => {
    const summary = summarizeMeterPerformance([
      { occurredAt: at(1), value: 100_000, liters: 50 },
      { occurredAt: at(5), value: 100_400, liters: 100 },  // 4 km/L
      { occurredAt: at(9), value: 100_900, liters: 100 },  // 5 km/L
    ])
    expect(summary.segments).toBe(2)
    expect(summary.bridged).toBe(0)
    expect(summary.litersMeasured).toBe(200)
    expect(summary.average).toBe(4.5)
    // Los litros de la primera carga pertenecen a un tramo anterior al archivo.
    expect(summary.litersUnmeasured).toBe(50)
  })

  it("ordena la serie aunque llegue desordenada", () => {
    const desordenada = summarizeMeterPerformance([
      { occurredAt: at(9), value: 100_900, liters: 100 },
      { occurredAt: at(1), value: 100_000, liters: 50 },
      { occurredAt: at(5), value: 100_400, liters: 100 },
    ])
    expect(desordenada.average).toBe(4.5)
    expect(desordenada.segments).toBe(2)
  })

  it("puentea el dígito perdido en vez de descartar la carga", () => {
    // El caso real: 720.325 km anotado como 72.000 en la boleta siguiente.
    const summary = summarizeMeterPerformance([
      { occurredAt: at(1), value: 720_325, liters: 50 },
      { occurredAt: at(5), value: 72_000, liters: 60 },
      { occurredAt: at(9), value: 720_900, liters: 40 },
    ])
    expect(summary.segments).toBe(1)
    expect(summary.bridged).toBe(1)
    // 575 km repartidos entre los 100 L de las dos cargas del tramo.
    expect(summary.average).toBe(5.75)
    expect(summary.litersMeasured).toBe(100)
  })

  it("reancla cuando el valor raro era el ancla y no la lectura siguiente", () => {
    const summary = summarizeMeterPerformance([
      { occurredAt: at(1), value: 1_000_000, liters: 50 },  // dígito de más
      { occurredAt: at(5), value: 100_500, liters: 60 },
      { occurredAt: at(9), value: 100_900, liters: 40 },
    ])
    expect(summary.reanchored).toBe(1)
    expect(summary.segments).toBe(1)
    expect(summary.average).toBe(10)
    expect(summary.litersMeasured).toBe(40)
    expect(summary.litersUnmeasured).toBe(110)
  })

  it("descarta el tramo cuyo rendimiento supera el techo configurado", () => {
    const summary = summarizeMeterPerformance([
      { occurredAt: at(1), value: 100_000, liters: 50 },
      { occurredAt: at(5), value: 105_000, liters: 100 },  // 50 km/L
    ])
    expect(summary.segments).toBe(0)
    expect(summary.average).toBe(0)
    expect(summary.litersUnmeasured).toBe(150)

    const conTechoAlto = summarizeMeterPerformance([
      { occurredAt: at(1), value: 100_000, liters: 50 },
      { occurredAt: at(5), value: 105_000, liters: 100 },
    ], { maxPerformance: 60 })
    expect(conTechoAlto.average).toBe(50)
  })

  it("usa el rendimiento del proveedor para la carga sin tramo propio", () => {
    const summary = summarizeMeterPerformance([
      { occurredAt: at(1), value: 100_000, liters: 50, providerPerformance: 3 },
      { occurredAt: at(5), value: 100_400, liters: 100 },
    ])
    expect(summary.litersFromProvider).toBe(50)
    expect(summary.litersUnmeasured).toBe(0)
    // (3 × 50 + 4 × 100) / 150
    expect(summary.average).toBe(3.67)
  })

  it("cae al proveedor cuando ninguna transacción trae lectura", () => {
    const summary = summarizeMeterPerformance([
      { occurredAt: at(1), value: null, liters: 100, providerPerformance: 4 },
      { occurredAt: at(5), value: null, liters: 100, providerPerformance: 0 },
    ])
    expect(summary.average).toBe(4)
    expect(summary.litersFromProvider).toBe(100)
    expect(summary.litersUnmeasured).toBe(100)
  })

  it("acumula los litros de una carga sin lectura en el tramo siguiente", () => {
    const summary = summarizeMeterPerformance([
      { occurredAt: at(1), value: 100_000, liters: 50 },
      { occurredAt: at(5), value: null, liters: 60 },
      { occurredAt: at(9), value: 100_500, liters: 40 },
    ])
    expect(summary.segments).toBe(1)
    expect(summary.bridged).toBe(0)
    expect(summary.average).toBe(5)
    expect(summary.litersMeasured).toBe(100)
  })

  it("no revienta con la serie vacía", () => {
    expect(summarizeMeterPerformance([])).toMatchObject({ average: 0, litersMeasured: 0, litersUnmeasured: 0 })
  })
})

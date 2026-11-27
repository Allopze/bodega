import { describe, expect, it } from "vitest"
import type { MantReading } from "@/lib/mantencion/types"
import { estimateNextDate, type EstimateInput } from "./planning-estimate"

const TODAY = "2026-11-27"

const reading = (date: string, value: number): MantReading => ({ date, value, source: "P-1" })

function input(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return {
    unit: "km",
    // 10 días a 240 km/día, la última lectura es de hoy.
    readings: [reading("2026-11-27", 12_400), reading("2026-11-17", 10_000)],
    gps: null,
    current: { value: 12_400, date: "2026-11-27" },
    remaining: 2_400,
    today: TODAY,
    ...overrides,
  }
}

describe("estimateNextDate · uso diario y fecha", () => {
  it("uso = pendiente de las lecturas de 30 días; fecha = hoy + faltantes ÷ uso", () => {
    const estimate = estimateNextDate(input())
    expect(estimate.dailyUsage).toBe(240)
    expect(estimate.estimatedDate).toBe("2026-12-07")
    expect(estimate.note).toBeNull()
  })

  it("sin lecturas no hay estimación y dice por qué", () => {
    const estimate = estimateNextDate(input({ readings: [], current: null }))
    expect(estimate).toMatchObject({ dailyUsage: null, estimatedDate: null })
    expect(estimate.note).toMatch(/Sin lecturas suficientes/)
  })

  it("una sola lectura no alcanza", () => {
    const estimate = estimateNextDate(input({ readings: [reading("2026-11-27", 12_400)] }))
    expect(estimate.estimatedDate).toBeNull()
    expect(estimate.note).toMatch(/Sin lecturas suficientes/)
  })

  it("lecturas fuera de la ventana de 30 días no cuentan", () => {
    const estimate = estimateNextDate(input({ readings: [reading("2026-11-27", 12_400), reading("2026-10-01", 5_000)] }))
    expect(estimate.estimatedDate).toBeNull()
  })

  it("dos lecturas del mismo día no son un uso", () => {
    const estimate = estimateNextDate(input({ readings: [reading("2026-11-27", 12_400), reading("2026-11-27", 12_300)] }))
    expect(estimate.estimatedDate).toBeNull()
  })

  it("uso cero o negativo: sin estimación", () => {
    const parado = estimateNextDate(input({ readings: [reading("2026-11-27", 10_000), reading("2026-11-17", 10_000)] }))
    expect(parado.estimatedDate).toBeNull()
    expect(parado.dailyUsage).toBeNull()
    expect(parado.note).toMatch(/no registra uso/)
    const atras = estimateNextDate(input({ readings: [reading("2026-11-27", 9_000), reading("2026-11-17", 10_000)] }))
    expect(atras.estimatedDate).toBeNull()
  })

  it("uso imposible (un error de lectura): sin estimación", () => {
    // 100.000 km en 10 días.
    const estimate = estimateNextDate(input({ readings: [reading("2026-11-27", 110_000), reading("2026-11-17", 10_000)] }))
    expect(estimate.estimatedDate).toBeNull()
    expect(estimate.dailyUsage).toBeNull()
    expect(estimate.note).toMatch(/no es creíble/)
  })

  it("en horas el límite diario es de 24 h", () => {
    const ok = estimateNextDate(input({ unit: "h", readings: [reading("2026-11-27", 1_080), reading("2026-11-17", 1_000)], current: { value: 1_080, date: "2026-11-27" }, remaining: 80 }))
    expect(ok.dailyUsage).toBe(8)
    expect(ok.estimatedDate).toBe("2026-12-07")
    const bad = estimateNextDate(input({ unit: "h", readings: [reading("2026-11-27", 1_300), reading("2026-11-17", 1_000)], current: { value: 1_300, date: "2026-11-27" } }))
    expect(bad.estimatedDate).toBeNull()
  })

  it("un punto del GPS más nuevo que la lectura oficial es el último punto y corre la fecha", () => {
    // La oficial es de hace 4 días (12.000); el GPS marca 12.400 hoy.
    const estimate = estimateNextDate(input({
      readings: [reading("2026-11-23", 12_000), reading("2026-11-13", 10_000)],
      current: { value: 12_000, date: "2026-11-23" },
      remaining: 2_800,
      gps: { value: 12_400, at: "2026-11-27T15:00:00.000Z" },
    }))
    // (12.400 − 10.000) ÷ 14 días = 171,4 km/día; faltan 2.400 desde el GPS.
    expect(estimate.dailyUsage).toBe(171.4)
    expect(estimate.estimatedDate).toBe("2026-12-11")
  })

  it("sin el GPS, una lectura vieja parte de su propia fecha y no de hoy", () => {
    const estimate = estimateNextDate(input({
      readings: [reading("2026-11-23", 12_000), reading("2026-11-13", 10_000)],
      current: { value: 12_000, date: "2026-11-23" },
      remaining: 2_000,
    }))
    // 200 km/día: faltan 10 días desde el 23-11 → 03-12.
    expect(estimate.estimatedDate).toBe("2026-12-03")
  })

  it("faltantes negativos: la fecha es pasada (desde cuándo está vencida)", () => {
    const estimate = estimateNextDate(input({ remaining: -2_400 }))
    expect(estimate.estimatedDate).toBe("2026-11-17")
  })

  it("aún no vencida según la lectura, la fecha no queda antes de hoy", () => {
    const estimate = estimateNextDate(input({
      readings: [reading("2026-11-12", 12_000), reading("2026-11-02", 10_000)],
      current: { value: 12_000, date: "2026-11-12" },
      remaining: 400,
    }))
    expect(estimate.estimatedDate).toBe(TODAY)
  })

  it("sin próxima (sin pauta) deja el uso pero no la fecha", () => {
    const estimate = estimateNextDate(input({ remaining: null }))
    expect(estimate.dailyUsage).toBe(240)
    expect(estimate.estimatedDate).toBeNull()
    expect(estimate.note).toMatch(/Sin pauta/)
  })

  it("una fecha a más de 10 años no se dibuja", () => {
    const estimate = estimateNextDate(input({ readings: [reading("2026-11-27", 10_010), reading("2026-11-17", 10_000)], current: { value: 10_010, date: "2026-11-27" }, remaining: 40_000 }))
    expect(estimate.estimatedDate).toBeNull()
    expect(estimate.note).toMatch(/más de 10 años/)
  })
})

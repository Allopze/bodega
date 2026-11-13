import { describe, expect, it } from "vitest"
import { pickGpsEstimateReading, type MeterSample } from "@/lib/mantencion/gps-estimate"

/**
 * Qué lectura sirve para estimar la próxima mantención: función pura, sin base.
 * Los instantes van a las 15:00 UTC, que en Chile cae siempre en la misma fecha civil.
 */
const at = (day: string) => `${day}T15:00:00.000Z`
const sample = (value: number, day: string): MeterSample => ({ value, at: at(day) })
const official = { value: 1000, date: "2026-11-01" }
const base = { unit: "h" as const, official, gps: null, visionlink: null, active: true, hasIntervals: true }

describe("pickGpsEstimateReading", () => {
  it("usa el horómetro de VisionLink cuando es más nuevo que la lectura oficial", () => {
    expect(pickGpsEstimateReading({ ...base, visionlink: sample(1040, "2026-11-08") }))
      .toEqual({ value: 1040, at: at("2026-11-08"), source: "visionlink" })
  })

  it("VisionLink gana al GPS del mismo día y al más viejo; el GPS más nuevo gana a VisionLink", () => {
    const gps = sample(1041, "2026-11-08")
    expect(pickGpsEstimateReading({ ...base, gps, visionlink: sample(1040, "2026-11-08") })?.source).toBe("visionlink")
    expect(pickGpsEstimateReading({ ...base, gps, visionlink: sample(1030, "2026-11-06") })).toEqual({ value: 1041, at: at("2026-11-08"), source: "gps" })
  })

  it("sin VisionLink (o si no es más nueva que la oficial) estima con el GPS", () => {
    const gps = sample(1020, "2026-11-05")
    expect(pickGpsEstimateReading({ ...base, gps })?.source).toBe("gps")
    expect(pickGpsEstimateReading({ ...base, gps, visionlink: sample(1010, "2026-11-01") })?.source).toBe("gps")
  })

  it("equipo retirado o sin pauta no se estima", () => {
    const visionlink = sample(1040, "2026-11-08")
    expect(pickGpsEstimateReading({ ...base, visionlink, active: false })).toBeNull()
    expect(pickGpsEstimateReading({ ...base, visionlink, hasIntervals: false })).toBeNull()
  })

  it("una lectura menor que la oficial o con un avance imposible se descarta, sin caer a la otra fuente", () => {
    expect(pickGpsEstimateReading({ ...base, visionlink: sample(900, "2026-11-08") })).toBeNull()
    // 7 días × 24 h = 168 h como máximo.
    expect(pickGpsEstimateReading({ ...base, visionlink: sample(1169, "2026-11-08") })).toBeNull()
    expect(pickGpsEstimateReading({ ...base, visionlink: sample(1168, "2026-11-08") })?.value).toBe(1168)
    expect(pickGpsEstimateReading({ ...base, gps: sample(1010, "2026-11-05"), visionlink: sample(900, "2026-11-08") })).toBeNull()
  })

  it("VisionLink no aplica a un odómetro", () => {
    expect(pickGpsEstimateReading({ ...base, unit: "km", visionlink: sample(1040, "2026-11-08") })).toBeNull()
    expect(pickGpsEstimateReading({ ...base, unit: "km", gps: sample(1500, "2026-11-02"), visionlink: sample(1040, "2026-11-08") })?.source).toBe("gps")
  })

  it("sin lectura oficial cualquier lectura es plausible", () => {
    expect(pickGpsEstimateReading({ ...base, official: null, visionlink: sample(5, "2026-11-08") })?.source).toBe("visionlink")
  })

  it("una lectura del mismo día que la oficial no se duplica", () => {
    expect(pickGpsEstimateReading({ ...base, visionlink: sample(1005, "2026-11-01") })).toBeNull()
  })
})

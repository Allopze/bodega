import { describe, expect, it } from "vitest"
import {
  bucketKey,
  bucketLabel,
  defaultIndicatorRange,
  indicatorGranularity,
  isPartialBucket,
  listBuckets,
  previousRange,
  rangeLengthDays,
  resolveIndicatorPeriod,
} from "./period"

const TODAY = "2026-11-13"

describe("período de Indicadores", () => {
  it("sin parámetros usa los últimos seis meses calendario con el en curso", () => {
    expect(defaultIndicatorRange(TODAY)).toEqual({ from: "2026-06-01", to: TODAY })
    const period = resolveIndicatorPeriod({}, TODAY)
    expect(period).toMatchObject({ from: "2026-06-01", to: TODAY, granularity: "month", isDefault: true, invalid: false })
  })

  it("cruza el año al retroceder seis meses", () => {
    expect(defaultIndicatorRange("2026-02-10")).toEqual({ from: "2025-09-01", to: "2026-02-10" })
  })

  it("toma el rango de la URL y deriva la granularidad por largo", () => {
    expect(resolveIndicatorPeriod({ desde: "2026-10-01", hasta: "2026-11-13" }, TODAY).granularity).toBe("day")
    expect(indicatorGranularity("2026-01-01", "2026-03-03")).toBe("day") // 62 días
    expect(indicatorGranularity("2026-01-01", "2026-03-04")).toBe("month") // 63 días
  })

  it("un rango invertido o una fecha imposible cae al por defecto y lo dice", () => {
    expect(resolveIndicatorPeriod({ desde: "2026-11-10", hasta: "2026-11-01" }, TODAY)).toMatchObject({ from: "2026-06-01", invalid: true })
    expect(resolveIndicatorPeriod({ desde: "2026-02-30", hasta: "2026-03-01" }, TODAY)).toMatchObject({ from: "2026-06-01", invalid: true })
  })

  it("el período anterior tiene el mismo largo y termina el día antes", () => {
    expect(previousRange("2026-11-01", "2026-11-30")).toEqual({ from: "2026-10-02", to: "2026-10-31" })
    expect(rangeLengthDays("2026-10-02", "2026-10-31")).toBe(30)
  })

  it("lista baldes vacíos incluidos", () => {
    expect(listBuckets("2026-10-30", "2026-11-02", "day")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])
    expect(listBuckets("2025-11-15", "2026-02-01", "month")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"])
  })

  it("rotula y marca el balde en curso", () => {
    expect(bucketKey("2026-11-13", "month")).toBe("2026-11")
    expect(bucketLabel("2026-11-03", "day")).toBe("3 nov")
    expect(bucketLabel("2026-09", "month")).toBe("sept 2026")
    expect(isPartialBucket("2026-11", "month", TODAY)).toBe(true)
    expect(isPartialBucket("2026-10", "month", TODAY)).toBe(false)
  })
})

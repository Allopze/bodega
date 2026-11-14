import { describe, expect, it } from "vitest"
import { alertBucketLabel, alertBucketTitle, hoursText, kmText, percentChange, rangeText, usageBucketLabel } from "./gps-format"

describe("gps-format", () => {
  it("la variación necesita una base mayor que cero", () => {
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(50, 100)).toBe(-50)
    expect(percentChange(10, 0)).toBeNull()
  })

  it("rotula baldes y semanas", () => {
    expect(usageBucketLabel("2026-11-03", "day")).toBe("3 nov")
    expect(usageBucketLabel("2026-11", "month")).toBe("nov 2026")
    expect(alertBucketLabel("2026-11-09", "week")).toBe("9 nov")
    expect(alertBucketTitle("2026-11-09", "week")).toBe("Semana del 9 nov")
    expect(alertBucketTitle("2026-11", "month")).toBe("nov 2026")
  })

  it("dice el rango con el formato del sistema", () => {
    expect(rangeText({ from: "2026-11-01", to: "2026-11-10" })).toBe("01-11-2026 al 10-11-2026")
  })

  it("formatea km y horas", () => {
    expect(kmText(12_430.4)).toBe("12.430 km")
    expect(hoursText(8.25)).toMatch(/^8,3? h$|^8,2 h$/)
    expect(hoursText(1_250.4)).toBe("1.250 h")
  })
})

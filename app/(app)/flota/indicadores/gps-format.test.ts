import { describe, expect, it } from "vitest"
import { alertBucketLabel, alertBucketTitle, hasComparableBase, hoursText, kmText, peakBucket, peakPhrase, percentChange, rangeText, usageBucketLabel } from "./gps-format"

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

interface Point { label: string; km: number | null; partial?: boolean }
const peakKm = (points: Point[]) => peakBucket<Point>(points, (point) => point.km)

describe("peakBucket", () => {
  const points: Point[] = [
    { label: "ago 2026", km: 10 },
    { label: "sept 2026", km: 40 },
    { label: "oct 2026", km: 25 },
    { label: "nov 2026", km: 90, partial: true },
  ]

  it("devuelve el balde de mayor valor e ignora el parcial", () => {
    expect(peakKm(points)).toEqual({ point: points[1], value: 40 })
  })

  it("en un empate gana el primero", () => {
    expect(peakKm([{ label: "a", km: 5 }, { label: "b", km: 5 }])?.point.label).toBe("a")
  })

  it("sin baldes cerrados con valor no hay pico", () => {
    expect(peakKm([{ label: "nov", km: 9, partial: true }])).toBeNull()
    expect(peakKm([{ label: "a", km: 0 }, { label: "b", km: 0 }])).toBeNull()
    expect(peakKm([{ label: "a", km: null }])).toBeNull()
    expect(peakKm([])).toBeNull()
  })

  it("dice el pico en lenguaje de mes o de día", () => {
    expect(peakPhrase("oct 2026", "month")).toBe("en oct 2026")
    expect(peakPhrase("3 nov", "day")).toBe("el 3 nov")
  })
})

describe("hasComparableBase", () => {
  it("compara cuando el período anterior tiene al menos la mitad de la cobertura", () => {
    expect(hasComparableBase(100, 100)).toBe(true)
    expect(hasComparableBase(100, 50)).toBe(true)
    expect(hasComparableBase(100, 49)).toBe(false)
  })

  it("sin cobertura previa no hay base, y un período previo más cubierto sí sirve", () => {
    expect(hasComparableBase(100, 0)).toBe(false)
    expect(hasComparableBase(0, 0)).toBe(false)
    expect(hasComparableBase(40, 100)).toBe(true)
  })
})

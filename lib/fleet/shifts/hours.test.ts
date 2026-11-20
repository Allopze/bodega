import { describe, expect, it } from "vitest"
import { chileHourKey, daysBetween, hourEndInstant, hourKeyId, parseVisionLinkUtc, shiftHourKeys, splitSegmentByChileHour } from "./hours"

const ids = (keys: Array<{ day: string; hour: number }>) => keys.map(hourKeyId)
const total = (pieces: Array<{ seconds: number }>) => pieces.reduce((sum, piece) => sum + piece.seconds, 0)

describe("shiftHourKeys", () => {
  it("un turno nocturno sigue en el día siguiente", () => {
    expect(ids(shiftHourKeys({ shiftDate: "2026-11-09", startHour: 22, endHour: 6 }))).toEqual([
      "2026-11-09|22", "2026-11-09|23",
      "2026-11-10|00", "2026-11-10|01", "2026-11-10|02", "2026-11-10|03", "2026-11-10|04", "2026-11-10|05",
    ])
  })

  it("un turno de día queda en su día", () => {
    const keys = shiftHourKeys({ shiftDate: "2026-11-09", startHour: 6, endHour: 14 })
    expect(keys).toHaveLength(8)
    expect(keys.every((key) => key.day === "2026-11-09")).toBe(true)
    expect(keys[0]!.hour).toBe(6)
    expect(keys[7]!.hour).toBe(13)
  })

  it("cruza el fin de mes", () => {
    expect(ids(shiftHourKeys({ shiftDate: "2026-11-30", startHour: 23, endHour: 1 }))).toEqual(["2026-11-30|23", "2026-12-01|00"])
  })
})

describe("parseVisionLinkUtc", () => {
  it("lee como UTC un texto sin Z", () => {
    expect(parseVisionLinkUtc("2026-11-20T14:32:51")).toBe(Date.UTC(2026, 10, 20, 14, 32, 51))
  })

  it("respeta la Z y un desfase explícito", () => {
    expect(parseVisionLinkUtc("2026-11-20T14:32:51Z")).toBe(Date.UTC(2026, 10, 20, 14, 32, 51))
    expect(parseVisionLinkUtc("2026-11-20T11:32:51-03:00")).toBe(Date.UTC(2026, 10, 20, 14, 32, 51))
  })

  it("un texto inválido es NaN", () => {
    expect(parseVisionLinkUtc("ayer")).toBeNaN()
  })
})

describe("splitSegmentByChileHour", () => {
  it("corta en el cambio de hora local (UTC−3 en noviembre)", () => {
    const pieces = splitSegmentByChileHour({ startUtc: "2026-11-18T08:50:00", endUtc: "2026-11-18T09:20:00", type: "idle" })
    expect(pieces).toEqual([
      { day: "2026-11-18", hour: 5, type: "idle", seconds: 600 },
      { day: "2026-11-18", hour: 6, type: "idle", seconds: 1200 },
    ])
  })

  it("un tramo que cruza la medianoche de Chile se reparte entre los dos días", () => {
    const pieces = splitSegmentByChileHour({ startUtc: "2026-11-19T02:45:00", endUtc: "2026-11-19T03:15:00", type: "working" })
    expect(ids(pieces)).toEqual(["2026-11-18|23", "2026-11-19|00"])
    expect(total(pieces)).toBe(1800)
  })

  it("un tramo vacío, invertido o inválido no da nada", () => {
    expect(splitSegmentByChileHour({ startUtc: "2026-11-18T09:00:00", endUtc: "2026-11-18T09:00:00", type: "idle" })).toEqual([])
    expect(splitSegmentByChileHour({ startUtc: "2026-11-18T10:00:00", endUtc: "2026-11-18T09:00:00", type: "idle" })).toEqual([])
    expect(splitSegmentByChileHour({ startUtc: "x", endUtc: "2026-11-18T09:00:00", type: "idle" })).toEqual([])
  })

  it("el día en que se atrasa el reloj, la hora repetida suma en una sola clave", () => {
    // 2026-04-05 00:00 (−03) vuelve a 2026-04-04 23:00 (−04): las 23 ocurren dos veces.
    const pieces = splitSegmentByChileHour({ startUtc: "2026-04-05T01:30:00", endUtc: "2026-04-05T04:30:00", type: "idle" })
    expect(total(pieces)).toBe(3 * 3600)
    expect(ids(pieces)).toEqual(["2026-04-04|22", "2026-04-04|23", "2026-04-05|00"])
    expect(pieces.find((piece) => piece.hour === 23)!.seconds).toBe(7200)
  })

  it("el día en que se adelanta el reloj, la hora que no existe no recibe nada", () => {
    // 2026-09-06 00:00 (−04) salta a 01:00 (−03).
    const pieces = splitSegmentByChileHour({ startUtc: "2026-09-06T03:30:00", endUtc: "2026-09-06T05:30:00", type: "working" })
    expect(total(pieces)).toBe(2 * 3600)
    expect(ids(pieces)).toEqual(["2026-09-05|23", "2026-09-06|01", "2026-09-06|02"])
  })
})

describe("hourEndInstant", () => {
  it("es el fin de esa hora local", () => {
    expect(hourEndInstant({ day: "2026-11-18", hour: 5 })).toBe(Date.UTC(2026, 10, 18, 9))
    expect(chileHourKey(hourEndInstant({ day: "2026-11-18", hour: 23 }))).toEqual({ day: "2026-11-19", hour: 0 })
  })

  it("una hora repetida termina en su segunda ocurrencia", () => {
    expect(hourEndInstant({ day: "2026-04-04", hour: 23 })).toBe(Date.UTC(2026, 3, 5, 4))
  })

  it("una hora que no existe termina en el salto", () => {
    expect(hourEndInstant({ day: "2026-09-06", hour: 0 })).toBe(Date.UTC(2026, 8, 6, 4))
  })
})

describe("daysBetween", () => {
  it("incluye los extremos", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])
  })
})

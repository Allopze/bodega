import { describe, expect, it } from "vitest"
import {
  indexPersonalUse,
  isPersonalUseDay,
  keptFraction,
  personalUseDaysIn,
  validatePersonalUsePeriod,
  type PersonalUsePeriod,
} from "./personal-use"

const closed: PersonalUsePeriod = { id: "p1", vehicleId: "v1", startedOn: "2026-10-10", endedOn: "2026-10-19", note: null }
const open: PersonalUsePeriod = { id: "p2", vehicleId: "v1", startedOn: "2026-11-21", endedOn: null, note: "Viaje" }
const index = indexPersonalUse([closed, open, { id: "p3", vehicleId: "v2", startedOn: "2026-01-01", endedOn: "2026-01-02", note: null }])

describe("isPersonalUseDay", () => {
  it("cubre el inicio, el término y un día intermedio, ambos extremos inclusivos", () => {
    expect(isPersonalUseDay(index, "v1", "2026-10-10")).toBe(true)
    expect(isPersonalUseDay(index, "v1", "2026-10-15")).toBe(true)
    expect(isPersonalUseDay(index, "v1", "2026-10-19")).toBe(true)
  })

  it("no cubre el día anterior ni el siguiente", () => {
    expect(isPersonalUseDay(index, "v1", "2026-10-09")).toBe(false)
    expect(isPersonalUseDay(index, "v1", "2026-10-20")).toBe(false)
  })

  it("un período abierto cubre hasta hoy y no después", () => {
    expect(isPersonalUseDay(index, "v1", "2026-11-25", "2026-11-25")).toBe(true)
    expect(isPersonalUseDay(index, "v1", "2026-11-26", "2026-11-25")).toBe(false)
  })

  it("un equipo sin períodos nunca está en uso personal", () => {
    expect(isPersonalUseDay(index, "v9", "2026-10-15")).toBe(false)
  })
})

describe("personalUseDaysIn / keptFraction", () => {
  it("cuenta los días solapados con un mes", () => {
    expect(personalUseDaysIn(index, "v1", "2026-10-01", "2026-10-31")).toBe(10)
    expect(keptFraction(index, "v1", "2026-10-01", "2026-10-31")).toBeCloseTo(21 / 31, 10)
  })

  it("un período abierto cuenta hasta hoy", () => {
    expect(personalUseDaysIn(index, "v1", "2026-11-01", "2026-11-30", "2026-11-30")).toBe(10)
    expect(keptFraction(index, "v1", "2026-11-01", "2026-11-30", "2026-11-30")).toBeCloseTo(20 / 30, 10)
  })

  it("un rango sin uso personal se conserva entero", () => {
    expect(personalUseDaysIn(index, "v1", "2026-09-01", "2026-09-30")).toBe(0)
    expect(keptFraction(index, "v1", "2026-09-01", "2026-09-30")).toBe(1)
    expect(keptFraction(index, "v9", "2026-09-01", "2026-09-30")).toBe(1)
  })

  it("un rango dentro del período no conserva nada", () => {
    expect(keptFraction(index, "v1", "2026-10-12", "2026-10-14")).toBe(0)
  })
})

describe("validatePersonalUsePeriod", () => {
  const today = "2026-11-20"
  const others = [closed]

  it("acepta un período contiguo a otro", () => {
    expect(validatePersonalUsePeriod({ startedOn: "2026-10-20", endedOn: "2026-10-25" }, others, today)).toBeNull()
    expect(validatePersonalUsePeriod({ startedOn: "2026-10-01", endedOn: "2026-10-09" }, others, today)).toBeNull()
  })

  it("acepta un período abierto que empieza hoy", () => {
    expect(validatePersonalUsePeriod({ startedOn: today, endedOn: null }, others, today)).toBeNull()
  })

  it("rechaza una fecha inválida", () => {
    expect(validatePersonalUsePeriod({ startedOn: "2026-02-30", endedOn: null }, [], today)).toMatch(/fecha/i)
    expect(validatePersonalUsePeriod({ startedOn: "", endedOn: null }, [], today)).toMatch(/fecha/i)
    expect(validatePersonalUsePeriod({ startedOn: "2026-10-01", endedOn: "31-10-2026" }, [], today)).toMatch(/fecha/i)
  })

  it("rechaza un inicio futuro", () => {
    expect(validatePersonalUsePeriod({ startedOn: "2026-11-21", endedOn: null }, [], today)).toMatch(/futur/i)
  })

  it("rechaza un término futuro", () => {
    expect(validatePersonalUsePeriod({ startedOn: "2026-11-01", endedOn: "2026-11-21" }, [], today)).toMatch(/futur|vacío/i)
  })

  it("rechaza un término anterior al inicio", () => {
    expect(validatePersonalUsePeriod({ startedOn: "2026-11-05", endedOn: "2026-11-04" }, [], today)).toMatch(/anterior/i)
  })

  it("rechaza un solape y nombra las fechas del otro período", () => {
    const message = validatePersonalUsePeriod({ startedOn: "2026-10-19", endedOn: "2026-10-22" }, others, today)
    expect(message).toContain("10-10-2026")
    expect(message).toContain("19-10-2026")
  })

  it("rechaza un abierto que empieza antes de un período cerrado posterior", () => {
    expect(validatePersonalUsePeriod({ startedOn: "2026-10-01", endedOn: null }, others, today)).not.toBeNull()
  })

  it("nombra «(en curso)» cuando choca con un período abierto", () => {
    expect(validatePersonalUsePeriod({ startedOn: "2026-11-22", endedOn: null }, [open], "2026-11-25")).toContain("(en curso)")
  })
})

import { describe, expect, it } from "vitest"
import { occurrenceDates } from "./schedule"

describe("fechas de ocurrencia", () => {
  it("mensual desde 01-03 hasta 31-12 da el último día de cada mes", () => {
    expect(occurrenceDates({ scheduleKind: "monthly", startsOn: "2026-03-01", periodEnd: "2026-12-31" })).toEqual([
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
      "2026-08-31",
      "2026-09-30",
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
    ])
  })

  it("trimestral desde 01-03 hasta 31-12 da 4", () => {
    expect(occurrenceDates({ scheduleKind: "quarterly", startsOn: "2026-03-01", periodEnd: "2026-12-31" })).toEqual([
      "2026-03-31",
      "2026-06-30",
      "2026-09-30",
      "2026-12-31",
    ])
  })

  it("semestral da 2 y anual da 1 en el mismo período", () => {
    expect(occurrenceDates({ scheduleKind: "semiannual", startsOn: "2026-03-01", periodEnd: "2026-12-31" })).toEqual([
      "2026-03-31",
      "2026-09-30",
    ])
    expect(occurrenceDates({ scheduleKind: "annual", startsOn: "2026-03-01", periodEnd: "2026-12-31" })).toEqual([
      "2026-03-31",
    ])
  })

  it("anual cruza de año", () => {
    expect(occurrenceDates({ scheduleKind: "annual", startsOn: "2026-03-01", periodEnd: "2027-12-31" })).toEqual([
      "2026-03-31",
      "2027-03-31",
    ])
  })

  it("una sola vez devuelve sólo startsOn", () => {
    expect(occurrenceDates({ scheduleKind: "once", startsOn: "2026-05-10", periodEnd: "2026-12-31" })).toEqual([
      "2026-05-10",
    ])
  })

  it("mes completo: mismo día de inicio a fin de mes", () => {
    expect(occurrenceDates({ scheduleKind: "monthly", startsOn: "2026-01-31", periodEnd: "2026-01-31" })).toEqual([
      "2026-01-31",
    ])
    expect(occurrenceDates({ scheduleKind: "monthly", startsOn: "2026-01-15", periodEnd: "2026-01-31" })).toEqual([
      "2026-01-31",
    ])
  })

  it("sin ocurrencias dentro del período devuelve lista vacía", () => {
    expect(occurrenceDates({ scheduleKind: "monthly", startsOn: "2026-01-01", periodEnd: "2026-01-15" })).toEqual([])
  })

  it("startsOn posterior a periodEnd da lista vacía", () => {
    expect(occurrenceDates({ scheduleKind: "monthly", startsOn: "2026-06-01", periodEnd: "2026-05-01" })).toEqual([])
    expect(occurrenceDates({ scheduleKind: "once", startsOn: "2026-06-01", periodEnd: "2026-05-01" })).toEqual([])
  })

  it("respeta el último día de febrero en año bisiesto", () => {
    expect(occurrenceDates({ scheduleKind: "monthly", startsOn: "2024-01-31", periodEnd: "2024-03-31" })).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
    ])
  })
})

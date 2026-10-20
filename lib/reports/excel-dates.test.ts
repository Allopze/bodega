import { describe, expect, it } from "vitest"
import { chileWallClockDate } from "@/lib/utils"
import { excelDateTime, excelPlainDate } from "@/lib/reports/excel-dates"

describe("excelDateTime", () => {
  it("lleva un timestamptz a la hora de pared de Chile (verano, UTC-3)", () => {
    // 19-10-2026 18:34Z es 15:34 en Chile: lo que dice la pantalla.
    const cell = excelDateTime("2026-10-19 18:34:14.564+00")!
    expect(cell.toISOString()).toBe("2026-10-19T15:34:14.564Z")
  })

  it("respeta el horario de invierno (UTC-4)", () => {
    const cell = excelDateTime("2026-06-15T12:00:00.000Z")!
    expect(cell.toISOString()).toBe("2026-06-15T08:00:00.000Z")
  })

  it("acepta un Date y cruza el cambio de día", () => {
    // 01:30Z del 20-10 es 22:30 del 19-10 en Chile.
    expect(excelDateTime(new Date("2026-10-20T01:30:00.000Z"))!.toISOString()).toBe("2026-10-19T22:30:00.000Z")
  })

  it("una fecha calendario no se desplaza", () => {
    expect(excelDateTime("2026-10-19")!.toISOString()).toBe("2026-10-19T00:00:00.000Z")
  })

  it("vacío o inválido devuelve null", () => {
    expect(excelDateTime(null)).toBeNull()
    expect(excelDateTime(undefined)).toBeNull()
    expect(excelDateTime("")).toBeNull()
    expect(excelDateTime("no es una fecha")).toBeNull()
  })
})

describe("excelPlainDate", () => {
  it("toma «YYYY-MM-DD» tal cual", () => {
    expect(excelPlainDate("2026-10-19")!.toISOString()).toBe("2026-10-19T00:00:00.000Z")
  })

  it("un instante cae en el día civil de Chile, no en el de UTC", () => {
    // 02:00Z del 20-10 todavía es 19-10 en Chile.
    expect(excelPlainDate("2026-10-20T02:00:00.000Z")!.toISOString()).toBe("2026-10-19T00:00:00.000Z")
  })

  it("vacío o inválido devuelve null", () => {
    expect(excelPlainDate("")).toBeNull()
    expect(excelPlainDate("2026-13-45x")).toBeNull()
  })
})

describe("chileWallClockDate", () => {
  it("suma el desfase de Chile del instante dado", () => {
    expect(chileWallClockDate(new Date("2026-10-19T18:34:00.000Z")).toISOString()).toBe("2026-10-19T15:34:00.000Z")
    expect(chileWallClockDate(new Date("2026-06-15T12:00:00.000Z")).toISOString()).toBe("2026-06-15T08:00:00.000Z")
  })
})

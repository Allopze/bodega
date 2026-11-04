import { describe, expect, it } from "vitest"
import { formatLastReading } from "./fleet-last-reading"

const none = { lastOdometerReading: null, lastHourMeterReading: null, lastReadingAt: null, lastReadingObjection: null }

describe("formatLastReading (celda «Última lectura» del Excel de Flota)", () => {
  it("odómetro en km con la cifra en es-CL y el día de la lectura", () => {
    expect(formatLastReading({ ...none, lastOdometerReading: 52_000, lastReadingAt: "2026-10-12T15:00:00.000Z" })).toBe("52.000 km · 12-10-2026")
  })

  it("a falta de odómetro, el horómetro en h con la coma decimal de es-CL (nunca toFixed)", () => {
    expect(formatLastReading({ ...none, lastHourMeterReading: 120.5, lastReadingAt: "2026-10-14T15:00:00.000Z" })).toBe("120,5 h · 14-10-2026")
  })

  it("el día es el chileno: una lectura a las 22:30 del 31 es del 31, no del 1 siguiente en UTC", () => {
    // 01:30 UTC del 1-nov = 22:30 del 31-oct en Chile (UTC-3).
    expect(formatLastReading({ ...none, lastOdometerReading: 10, lastReadingAt: "2026-11-01T01:30:00.000Z" })).toBe("10 km · 31-10-2026")
  })

  it("una lectura objetada lleva la misma marca que el aviso de la tabla, con la regla que la objetó", () => {
    expect(formatLastReading({
      ...none, lastOdometerReading: 1_030, lastReadingAt: "2026-10-13T15:00:00.000Z",
      lastReadingObjection: { caseId: "case-1", ruleLabel: "Kilometraje regresivo" },
    })).toBe("1.030 km · 13-10-2026 · Lectura objetada: Kilometraje regresivo")
  })

  it("sin lectura la celda queda vacía: la ausencia de dato no es «0 km»", () => {
    expect(formatLastReading(none)).toBe("")
    // Un cero real sí es una lectura.
    expect(formatLastReading({ ...none, lastOdometerReading: 0, lastReadingAt: "2026-10-13T15:00:00.000Z" })).toBe("0 km · 13-10-2026")
  })

  it("si falta la fecha dice sólo la cifra, sin inventar un día", () => {
    expect(formatLastReading({ ...none, lastOdometerReading: 52_000 })).toBe("52.000 km")
  })
})

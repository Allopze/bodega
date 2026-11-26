import { describe, expect, it } from "vitest"
import { checkEntryReading, ENTRY_READING_MAX, lastKnownReading, lastReadingText, readingToText, type EntryReadings } from "./ot-entry-reading"

const KNOWN: EntryReadings = { readings: [{ value: 7501, date: "2026-11-10", source: "MC-STF-0003" }], initial: { value: 7000, date: "2026-01-05", source: "Lectura inicial" } }

describe("readingToText", () => {
  it("devuelve el texto del campo sin miles y con la coma decimal", () => {
    expect(readingToText(7600)).toBe("7600")
    expect(readingToText(7600.5)).toBe("7600,5")
    expect(readingToText(8.1)).toBe("8,1")
    expect(readingToText(null)).toBe("")
    expect(readingToText(undefined)).toBe("")
  })
})

describe("lastReadingText", () => {
  it("dice la última lectura con su fecha, o que no hay, o nada si no se cargó el equipo", () => {
    expect(lastReadingText(KNOWN, "h")).toBe("Última lectura registrada: 7.501 h · 10-11-2026")
    expect(lastReadingText({ readings: [], initial: KNOWN.initial }, "h")).toBe("Última lectura registrada: 7.000 h · 05-01-2026")
    expect(lastReadingText({ readings: [], initial: null }, "km")).toBe("No hay lecturas anteriores de este equipo.")
    expect(lastReadingText(null, "km")).toBeNull()
    expect(lastKnownReading(null)).toBeNull()
  })
})

describe("checkEntryReading", () => {
  const check = (text: string, workDate = "2026-11-12", known: typeof KNOWN | null = KNOWN) => checkEntryReading({ text, unit: "h", workDate, known })

  it("el punto de miles es de miles: «8.100» son 8100 y no 8,1 (OTN-6)", () => {
    expect(check("8100")).toMatchObject({ ok: true, value: 8100 })
    expect(check("8.100")).toMatchObject({ ok: true, value: 8100 })
    expect(check("7.520")).toMatchObject({ ok: true, value: 7520, jump: null })
    // Un decimal con coma o con un solo dígito tras el punto sigue siendo decimal.
    expect(check("7520,5")).toMatchObject({ ok: true, value: 7520.5 })
    expect(check("7520.5")).toMatchObject({ ok: true, value: 7520.5 })
  })

  it("un aumento grande se devuelve como salto por confirmar, con la pregunta de la app", () => {
    const result = check("8.100")
    expect(result.ok && result.jump?.question).toBe("Son 599 h más que la última vez. ¿Está bien?")
  })

  it("menor que la última lectura: dice cuál y de qué fecha", () => {
    expect(check("7.000")).toEqual({ ok: false, message: "Es menor que la lectura de 7.501 h del 10-11-2026 (MC-STF-0003). Revisa el número o la fecha." })
  })

  it("con fecha anterior a otra lectura, no puede pasarla", () => {
    const known = { readings: [{ value: 7501, date: "2026-11-10", source: "MC-STF-0003" }, { value: 7650, date: "2026-11-14", source: "MC-STF-0004" }], initial: null }
    expect(check("7.700", "2026-11-12", known)).toEqual({ ok: false, message: "Es mayor que la lectura de 7.650 h registrada después, el 14-11-2026 (MC-STF-0004). Revisa el número o la fecha." })
  })

  it("sin dígitos no se entiende: pide la lectura de la unidad del equipo", () => {
    expect(check("")).toEqual({ ok: false, message: "Ingresa la lectura del horómetro." })
    expect(check("abc")).toEqual({ ok: false, message: "Ingresa la lectura del horómetro." })
    expect(checkEntryReading({ text: "", unit: "km", workDate: "2026-11-12", known: null })).toEqual({ ok: false, message: "Ingresa la lectura del odómetro." })
  })

  it("sobre el tope de la columna lo dice, en vez de dejar que falle el servidor", () => {
    expect(ENTRY_READING_MAX).toBe(99_999_999)
    expect(check("123.456.789")).toEqual({ ok: false, message: "La lectura no puede pasar de 99.999.999." })
    expect(check("99.999.999")).toMatchObject({ ok: true, value: 99_999_999 })
  })

  it("sin las lecturas del equipo sólo lee el número", () => {
    expect(check("8.100", "2026-11-12", null)).toEqual({ ok: true, value: 8100, jump: null })
    expect(check("0", "2026-11-12", null)).toEqual({ ok: true, value: 0, jump: null })
  })
})

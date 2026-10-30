import { describe, expect, it } from "vitest"
import {
  brandAndModel, dueText, EQUIPMENT_STATE_LABEL, executorText, formatHours, formatNumber, formatReading, meterName, parseReadingInput,
  plural, recordKindText, remainingText, unitName,
} from "../format"
import { MANT_EQUIPMENT_STATES } from "../types"

describe("formatos (§14): miles con punto, decimales con coma, unidades visibles", () => {
  it("formatNumber", () => {
    expect(formatNumber(900)).toBe("900")
    expect(formatNumber(4_000)).toBe("4.000")
    expect(formatNumber(40_312)).toBe("40.312")
    expect(formatNumber(1.5)).toBe("1,5")
    expect(formatNumber(4_000.5)).toBe("4.000,5")
  })

  it("formatReading lleva siempre la unidad", () => {
    expect(formatReading(40_312, "km")).toBe("40.312 km")
    expect(formatReading(5_400, "h")).toBe("5.400 h")
  })

  it("formatHours usa coma decimal", () => {
    expect(formatHours(1.5)).toBe("1,5 h")
    expect(formatHours(1)).toBe("1 h")
    expect(formatHours(72)).toBe("72 h")
  })

  it("nombres de unidad y de medidor", () => {
    expect(unitName("km")).toBe("kilómetros")
    expect(unitName("h")).toBe("horas")
    expect(meterName("km")).toBe("odómetro")
    expect(meterName("h")).toBe("horómetro")
  })

  it("brandAndModel no repite la marca cuando el modelo ya empieza con ella", () => {
    expect(brandAndModel("Scania", "R450")).toBe("Scania R450")
    expect(brandAndModel("Ford Cargo", "Ford Cargo 5032 E")).toBe("Ford Cargo 5032 E")
    // Sin tildes ni mayúsculas, y con la marca escrita aparte del modelo.
    expect(brandAndModel("Mercedes", "mercedes 1720")).toBe("mercedes 1720")
    expect(brandAndModel("Ford", "Cargo 2628")).toBe("Ford Cargo 2628")
    // La marca termina con la palabra con que empieza el modelo: va una sola vez.
    expect(brandAndModel("Ford Cargo", "Cargo 2628")).toBe("Ford Cargo 2628")
    expect(brandAndModel("Ford Cargo", "cargo 1722 E")).toBe("Ford Cargo 1722 E")
    // Un modelo que es SÓLO esa palabra no queda vacío.
    expect(brandAndModel("Ford Cargo", "Cargo")).toBe("Ford Cargo")
    // Sólo cuenta en el límite de una palabra.
    expect(brandAndModel("Ford", "Fordson")).toBe("Ford Fordson")
    expect(brandAndModel("Mercedes", "Mercedes-Benz 1720")).toBe("Mercedes-Benz 1720")
    // Sin modelo, o sin marca, queda lo que hay.
    expect(brandAndModel("Caterpillar", null)).toBe("Caterpillar")
    expect(brandAndModel("Caterpillar", "  ")).toBe("Caterpillar")
    expect(brandAndModel("", "M2")).toBe("M2")
    expect(brandAndModel(null, undefined)).toBe("")
  })

  it("plural cuenta con separador de miles y concuerda con 1", () => {
    expect(plural(1, "registro", "registros")).toBe("1 registro")
    expect(plural(0, "registro", "registros")).toBe("0 registros")
    expect(plural(1_000, "registro", "registros")).toBe("1.000 registros")
  })

  it("etiquetas de estado: hay una para cada estado de la regla 6", () => {
    for (const state of MANT_EQUIPMENT_STATES) expect(EQUIPMENT_STATE_LABEL[state], state).toBeTruthy()
    expect(EQUIPMENT_STATE_LABEL.baja).toBe("Dado de baja")
  })
})

describe("parseReadingInput", () => {
  it("separa miles mientras se escribe", () => {
    expect(parseReadingInput("40312")).toEqual({ value: 40_312, text: "40.312" })
    expect(parseReadingInput("5400")).toEqual({ value: 5_400, text: "5.400" })
  })

  it("descarta todo lo que no sea dígito, incluido el separador que ya se había puesto", () => {
    expect(parseReadingInput("40.312 km")).toEqual({ value: 40_312, text: "40.312" })
    expect(parseReadingInput("1,5")).toEqual({ value: 15, text: "15" })
  })

  it("vacío o sin dígitos no es una lectura", () => {
    expect(parseReadingInput("")).toEqual({ value: null, text: "" })
    expect(parseReadingInput("abc")).toEqual({ value: null, text: "" })
  })

  it("quita ceros a la izquierda pero conserva un cero solo", () => {
    expect(parseReadingInput("0040")).toEqual({ value: 40, text: "40" })
    expect(parseReadingInput("0")).toEqual({ value: 0, text: "0" })
  })

  it("corta en nueve dígitos", () => {
    expect(parseReadingInput("1234567890")).toEqual({ value: 123_456_789, text: "123.456.789" })
  })
})

describe("textos de «le toca mantención»", () => {
  it("remainingText: faltan o pasada por", () => {
    expect(remainingText({ remaining: 141 }, "km")).toBe("faltan 141 km")
    expect(remainingText({ remaining: -312 }, "km")).toBe("pasada por 312 km")
    expect(remainingText({ remaining: 45 }, "h")).toBe("faltan 45 h")
    expect(remainingText({ remaining: null }, "km")).toBe("")
  })

  it("dueText: «Toca la de 40.000 km · faltan 141 km»", () => {
    expect(dueText({ remaining: 141, nextIntervalValue: 40_000 }, "km")).toBe("Toca la de 40.000 km · faltan 141 km")
    expect(dueText({ remaining: -20, nextIntervalValue: 900 }, "h")).toBe("Toca la de 900 h · pasada por 20 h")
  })

  it("dueText sin intervalo no dice nada", () => {
    expect(dueText({ remaining: null, nextIntervalValue: null }, "km")).toBe("")
  })

  it("recordKindText", () => {
    expect(recordKindText("P", 40_000, "km")).toBe("Preventiva 40.000 km")
    expect(recordKindText("P", null, "km")).toBe("Preventiva")
    expect(recordKindText("C", null, "h")).toBe("Correctiva")
    expect(recordKindText("C", 5, "km")).toBe("Correctiva")
  })
})

describe("regla 10 · otro mecánico", () => {
  it("quien registra y ejecuta es la misma persona: sólo su nombre", () => {
    expect(executorText({ executorKind: "yo", registeredByName: "Javier Roa", executorName: "Javier Roa" })).toBe("Javier Roa")
  })

  it("«Registrado por X en nombre de Y»", () => {
    expect(executorText({ executorKind: "otro_mecanico", registeredByName: "Javier Roa", executorName: "Luis Campos" }))
      .toBe("Registrado por Javier Roa en nombre de Luis Campos")
  })

  it("taller externo: nombra el taller y quién registró", () => {
    expect(executorText({ executorKind: "externo", registeredByName: "Javier Roa", executorName: "Maestranza Melo" }))
      .toBe("Maestranza Melo (taller externo) · registrado por Javier Roa")
  })
})

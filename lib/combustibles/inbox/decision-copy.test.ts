import { describe, expect, it } from "vitest"
import { FLAG_DECISION_COPY, FLAG_REASONS } from "@/lib/combustibles/control/contracts"
import {
  decisionCopyFor,
  FLAG_REASON_PRIORITY,
  flagDatum,
  flagReasonsLabel,
  flagReasonTitle,
  knownFlagReasons,
  MAX_DECISION_NOTE_LENGTH,
  MIN_DECISION_NOTE_LENGTH,
  primaryFlagReason,
  validateDecisionNote,
  type FlagDatumInput,
} from "./reasons"

const base: FlagDatumInput = {
  liters: 85,
  meterReading: 182_310,
  meterType: "odometer",
  performanceValue: null,
  performanceUnit: null,
  capacity: null,
  previousReading: null,
  original: null,
  occurredAt: "2026-10-27T15:04:00.000Z",
  originLabel: "Planilla de cargas",
  rawEquipment: null,
  registeredAt: "2026-10-27T15:10:00.000Z",
  range: null,
}

describe("rótulos de la decisión según el motivo", () => {
  it("todo motivo del contrato tiene sus dos rótulos y su efecto", () => {
    for (const reason of FLAG_REASONS) {
      const copy = FLAG_DECISION_COPY[reason]
      expect(copy.yes.length, reason).toBeGreaterThan(0)
      expect(copy.no.length, reason).toBeGreaterThan(0)
      expect(copy.yesEffect.length, reason).toBeGreaterThan(0)
      expect(copy.noEffect.length, reason).toBeGreaterThan(0)
    }
  })

  it("la prioridad cubre exactamente los motivos que existen", () => {
    expect([...FLAG_REASON_PRIORITY].sort()).toEqual([...FLAG_REASONS].sort())
  })

  it("una duplicada pregunta si son dos cargas, no si «cuenta»", () => {
    expect(decisionCopyFor(["duplicate"])).toMatchObject({ yes: "Son dos cargas distintas", no: "Es la misma carga" })
  })

  it("una lectura menor a la anterior usa Cuenta / No cuenta", () => {
    expect(decisionCopyFor(["meter_regression"])).toMatchObject({ yes: "Cuenta", no: "No cuenta" })
  })

  it("con varios motivos manda el de mayor prioridad: la duplicada gana a la atípica", () => {
    expect(primaryFlagReason(["outlier", "duplicate"])).toBe("duplicate")
    expect(decisionCopyFor(["outlier", "duplicate"]).yes).toBe("Son dos cargas distintas")
    expect(primaryFlagReason(["outlier", "implausible"])).toBe("implausible")
    expect(primaryFlagReason(["unknown_vehicle", "duplicate"])).toBe("unknown_vehicle")
  })

  it("sin motivo conocido cae en Cuenta / No cuenta y nunca lanza", () => {
    expect(decisionCopyFor([])).toMatchObject({ yes: "Cuenta", no: "No cuenta" })
    expect(decisionCopyFor(["inventado"]).yes).toBe("Cuenta")
    expect(flagReasonTitle([])).toBe("Carga por decidir")
  })

  it("los motivos de la fila salen del jsonb sólo si el contrato los conoce, en su orden", () => {
    expect(knownFlagReasons(["duplicate", "x", 3, "over_capacity"])).toEqual(["over_capacity", "duplicate"])
    expect(knownFlagReasons(null)).toEqual([])
    expect(flagReasonsLabel(["outlier", "duplicate"])).toBe("Posible carga duplicada · Rendimiento atípico para el equipo")
  })

  it("«registrada después» tiene su etiqueta y su par de rótulos", () => {
    expect(flagReasonTitle(["late_entry"])).toBe("Registrada después (fecha pasada)")
    expect(decisionCopyFor(["late_entry"]).yesEffect).toMatch(/fecha declarada/i)
  })
})

describe("el dato que explica cada motivo", () => {
  it("lectura menor: la lectura y la anterior, con su unidad", () => {
    expect(flagDatum(["meter_regression"], { ...base, previousReading: 182_900 })).toBe("182.310 km; la carga anterior marcó 182.900 km")
    expect(flagDatum(["meter_regression"], { ...base, meterType: "hour_meter", meterReading: 6_410, previousReading: 6_500 })).toContain("h;")
    expect(flagDatum(["meter_regression"], { ...base, previousReading: null })).toMatch(/menor a la lectura anterior/)
  })

  it("sobre la capacidad: los litros contra el estanque", () => {
    expect(flagDatum(["over_capacity"], { ...base, liters: 420, capacity: 400 })).toBe("420 L en un estanque de 400 L")
  })

  it("sin ficha: el código tal como llegó", () => {
    expect(flagDatum(["unknown_vehicle"], { ...base, rawEquipment: "TR-01" })).toBe("El origen trae el código TR-01, que no está en el catálogo")
  })

  it("atípica: el rendimiento y lo normal del equipo", () => {
    const text = flagDatum(["outlier"], { ...base, performanceValue: 21.4, performanceUnit: "liters_per_hour", range: { low: 12.8, high: 16.2 } })
    expect(text).toBe("21,4 L/h; lo normal para este equipo es entre 12,8 y 16,2 L/h")
    expect(flagDatum(["outlier"], { ...base, performanceValue: 21.4, performanceUnit: "liters_per_hour" })).toBe("21,4 L/h")
  })

  it("duplicada: las dos cargas con su origen y hora", () => {
    const text = flagDatum(["duplicate"], {
      ...base,
      originLabel: "Planilla de cargas",
      original: { liters: 85, occurredAt: "2026-10-27T15:09:00.000Z", originLabel: "Registro en terreno" },
    })
    expect(text).toMatch(/^Planilla de cargas a las \d{2}:\d{2} y registro en terreno a las \d{2}:\d{2}, de 85 y 85 L$/)
  })
})

describe("nota de la decisión", () => {
  it("exige de 10 a 500 caracteres sobre el texto recortado", () => {
    expect(MIN_DECISION_NOTE_LENGTH).toBe(10)
    expect(MAX_DECISION_NOTE_LENGTH).toBe(500)
    expect(validateDecisionNote("corta")).toMatch("10")
    expect(validateDecisionNote("   123456789   ")).not.toBeNull()
    expect(validateDecisionNote("1234567890")).toBeNull()
    expect(validateDecisionNote("x".repeat(500))).toBeNull()
    expect(validateDecisionNote("x".repeat(501))).not.toBeNull()
  })
})

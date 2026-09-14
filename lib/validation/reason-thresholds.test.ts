/**
 * Patrón P6 (auditoría 2026-09-14): el umbral de un motivo dependía de quién
 * había escrito el formulario — 1, 5, 10 o ninguno —, y la operación de menos
 * control era la que menos explicación pedía.
 */
import { describe, expect, it } from "vitest"
import {
  isValidReason,
  reasonRequiredMessage,
  reasonSchema,
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
} from "./reason-thresholds"

describe("umbral único de motivo", () => {
  it("es el que ya usaba la mayoría de la plataforma", () => {
    // Si alguien lo cambia, que sea una decisión y no un descuido: anular una
    // entrega, regularizar integridad y cerrar una faena ya exigían diez.
    expect(REASON_MIN_LENGTH).toBe(10)
    expect(REASON_MAX_LENGTH).toBe(1000)
  })

  it("descarta el punto y la letra suelta", () => {
    expect(isValidReason(".")).toBe(false)
    expect(isValidReason("error")).toBe(false)
    expect(isValidReason("")).toBe(false)
    expect(isValidReason(null)).toBe(false)
    expect(isValidReason(undefined)).toBe(false)
  })

  it("no cuenta los espacios de relleno", () => {
    expect(isValidReason("   ok     ")).toBe(false)
    expect(isValidReason(`  ${"x".repeat(10)}  `)).toBe(true)
  })

  it("acepta una explicación real y rechaza un informe", () => {
    expect(isValidReason("Error de digitación en la cantidad recibida")).toBe(true)
    expect(isValidReason("x".repeat(REASON_MAX_LENGTH))).toBe(true)
    expect(isValidReason("x".repeat(REASON_MAX_LENGTH + 1))).toBe(false)
  })
})

describe("reasonSchema", () => {
  it("recorta y valida como la regla suelta", () => {
    expect(reasonSchema("el ajuste").parse("  Conteo mal digitado  ")).toBe("Conteo mal digitado")
    expect(reasonSchema("el ajuste").safeParse("corto").success).toBe(false)
  })

  it("el mensaje dice qué explicar, no sólo que falta texto", () => {
    const result = reasonSchema("por qué se anula la guía").safeParse("x")
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Explica por qué se anula la guía en al menos 10 caracteres",
      )
    }
    expect(reasonRequiredMessage("el ajuste de inventario"))
      .toBe("Explica el ajuste de inventario en al menos 10 caracteres")
  })
})

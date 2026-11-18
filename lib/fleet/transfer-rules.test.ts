import { describe, expect, it } from "vitest"
import {
  MAX_VEHICLES_PER_TRANSFER,
  formatTransferFolio,
  transferDateError,
  transferDateWindow,
  transferTextErrors,
} from "./transfer-rules"

describe("transferDateWindow", () => {
  it("abre en el día 1 del mes anterior y cierra hoy", () => {
    expect(transferDateWindow("2026-11-18")).toEqual({ min: "2026-10-01", max: "2026-11-18" })
  })

  it("cruza el cambio de año", () => {
    expect(transferDateWindow("2026-01-05")).toEqual({ min: "2025-12-01", max: "2026-01-05" })
  })
})

describe("transferDateError", () => {
  const today = "2026-11-18"

  it("rechaza una fecha futura", () => {
    expect(transferDateError("2026-11-19", today, null)).toBe("La fecha no puede ser posterior a hoy.")
  })

  it("rechaza una fecha anterior al mes pasado", () => {
    expect(transferDateError("2026-09-30", today, null)).toBe("La fecha no puede ser anterior al 01-10-2026.")
  })

  it("exige ser posterior al inicio de la estadía actual", () => {
    expect(transferDateError("2026-10-02", today, "2026-10-02")).toBe(
      "Llegó a su faena actual el 02-10-2026: la fecha debe ser posterior.",
    )
    expect(transferDateError("2026-10-03", today, "2026-10-02")).toBeNull()
  })

  it("acepta los bordes de la ventana", () => {
    expect(transferDateError("2026-10-01", today, null)).toBeNull()
    expect(transferDateError("2026-11-18", today, null)).toBeNull()
  })

  it("rechaza fechas con formato o calendario inválido", () => {
    expect(transferDateError("2026-13-01", today, null)).toBe("La fecha no es válida.")
    expect(transferDateError("2026-02-30", today, null)).toBe("La fecha no es válida.")
    expect(transferDateError("18-11-2026", today, null)).toBe("La fecha no es válida.")
    expect(transferDateError("", today, null)).toBe("La fecha no es válida.")
  })
})

describe("transferTextErrors", () => {
  it("pide motivo de 10 caracteres y autorizante de 3, tras recortar", () => {
    expect(transferTextErrors({ reason: " corto ", authorizedBy: "G" })).toEqual({
      reason: "Explica el motivo en al menos 10 caracteres.",
      authorizedBy: "Indica quién lo autorizó.",
    })
  })

  it("no marca error cuando los textos alcanzan el mínimo", () => {
    expect(transferTextErrors({ reason: "Cambio de contrato", authorizedBy: "Gil" })).toEqual({})
    expect(transferTextErrors({ reason: "1234567890", authorizedBy: " Ana " })).toEqual({})
  })
})

describe("formatTransferFolio", () => {
  it("rellena a cuatro dígitos y no trunca los más largos", () => {
    expect(formatTransferFolio(7)).toBe("TR-0007")
    expect(formatTransferFolio(12345)).toBe("TR-12345")
  })
})

describe("MAX_VEHICLES_PER_TRANSFER", () => {
  it("es 100", () => {
    expect(MAX_VEHICLES_PER_TRANSFER).toBe(100)
  })
})

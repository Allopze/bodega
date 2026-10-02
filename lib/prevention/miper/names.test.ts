import { describe, expect, it } from "vitest"
import { cleanMiperName, headcountFromSexCounts, normalizeMiperName } from "./names"

describe("nombres de diccionario MIPER", () => {
  it("dos escrituras del mismo nombre normalizan igual", () => {
    expect(normalizeMiperName("Carga de lodo")).toBe(normalizeMiperName("  carga  DE lodo "))
    expect(normalizeMiperName("Mantención")).toBe(normalizeMiperName("mantencion"))
  })
  it("limpia espacios y devuelve null si queda vacío", () => {
    expect(cleanMiperName("  Operador   de grúa ")).toBe("Operador de grúa")
    expect(cleanMiperName("   ")).toBeNull()
    expect(cleanMiperName(null)).toBeNull()
  })
})

describe("dotación por sexo", () => {
  it("hombres, mujeres y el resto como Otro; sin registrar se informa aparte", () => {
    const result = headcountFromSexCounts([
      { sex: "male", count: 14 }, { sex: "female", count: 2 },
      { sex: "other", count: 2 }, { sex: null, count: 3 },
    ])
    expect(result).toEqual({ total: 21, male: 14, female: 2, other: 5, unrecorded: 3 })
  })
})

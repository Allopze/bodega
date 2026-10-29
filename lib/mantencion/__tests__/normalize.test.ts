import { describe, expect, it } from "vitest"
import {
  cleanName, deriveFolioCode, findByNameKey, formatFolio, isValidPlate, nameKey, normalizeCode, normalizePlate, resolvePlate,
} from "../normalize"

describe("regla 17 · faena nueva no duplica", () => {
  it("«cholguán» y «Cholguan» son la misma faena", () => {
    expect(nameKey("cholguán")).toBe(nameKey("Cholguan"))
    expect(nameKey("  CHOLGUÁN ")).toBe("cholguan")
    expect(nameKey("Santa   Fe")).toBe("santa fe")
    expect(nameKey("Pacífico")).toBe("pacifico")
    expect(nameKey("Ñuble")).toBe("nuble")
  })

  it("cleanName respeta tildes y mayúsculas pero ordena los espacios", () => {
    expect(cleanName("  Flor   del  Laja ")).toBe("Flor del Laja")
    expect(cleanName("Pacífico")).toBe("Pacífico")
  })

  it("findByNameKey devuelve la existente con su nombre original", () => {
    const faenas = [{ id: "1", name: "Cholguan" }, { id: "2", name: "Santa Fe" }]
    expect(findByNameKey(faenas, "cholguán")).toBe(faenas[0])
    expect(findByNameKey(faenas, " SANTA  FE ")).toBe(faenas[1])
  })

  it("una faena realmente nueva, o un texto vacío, no coincide con nada", () => {
    const faenas = [{ id: "1", name: "Cholguan" }]
    expect(findByNameKey(faenas, "Calymag")).toBeNull()
    expect(findByNameKey(faenas, "   ")).toBeNull()
    expect(findByNameKey(faenas, "")).toBeNull()
  })
})

describe("regla 16 · patente", () => {
  it("pasa a mayúsculas, sin espacios ni puntos, con guion antes de los números", () => {
    expect(normalizePlate("rbyd 98")).toBe("RBYD-98")
    expect(normalizePlate("ab.1234")).toBe("AB-1234")
    expect(normalizePlate("BCDF12")).toBe("BCDF-12")
    expect(normalizePlate("  zy 3880 ")).toBe("ZY-3880")
    expect(normalizePlate("ab-12-34")).toBe("AB-1234")
  })

  it("lo que no es letras seguidas de números no es patente", () => {
    expect(normalizePlate("Sin patente")).toBeNull()
    expect(normalizePlate("1234")).toBeNull()
    expect(normalizePlate("")).toBeNull()
    expect(normalizePlate("AB12CD")).toBeNull()
  })

  it("acepta los formatos antiguo (AB-1234) y nuevo (BCDF-12, sin vocales)", () => {
    for (const plate of ["AB-1234", "WT-1699", "ZY-3880", "BCDF-12", "RBYD-98", "SGCP-84", "KLJZ-68", "JFDR-85"]) {
      expect(isValidPlate(plate), plate).toBe(true)
    }
  })

  it("rechaza vocales en el formato nuevo, largos incorrectos y códigos de equipo", () => {
    for (const plate of ["AEIO-12", "BCDA-12", "BCDF-1", "BCDF-123", "AB-123", "AB-12345", "ABC-123", "TO-37", "GR-08"]) {
      expect(isValidPlate(plate), plate).toBe(false)
    }
  })

  it("resolvePlate normaliza y valida", () => {
    expect(resolvePlate("rbyd 98", "KA-135", false)).toEqual({ ok: true, plate: "RBYD-98", noPlate: false })
  })

  it("resolvePlate pide la patente si falta y la nombra si es inválida", () => {
    const missing = resolvePlate("", "KA-135", false)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.message).toContain("Escribe la patente")
    const typedAsText = resolvePlate("Sin patente", "KA-135", false)
    expect(typedAsText.ok).toBe(false)
    const invalid = resolvePlate("to 37", "TO-37", false)
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.message).toContain("«TO-37» no es una patente válida")
  })

  it("«Sin patente» explícito: la patente guardada es el código", () => {
    expect(resolvePlate(null, "to-37", true)).toEqual({ ok: true, plate: "TO-37", noPlate: true })
    expect(resolvePlate("lo que sea", "GR 08", true)).toEqual({ ok: true, plate: "GR08", noPlate: true })
  })

  it("normalizeCode: mayúsculas y sin espacios", () => {
    expect(normalizeCode(" ka-135 ")).toBe("KA-135")
    expect(normalizeCode("k a 135")).toBe("KA135")
  })
})

describe("regla 12 · folio", () => {
  it("MP-BIO-0001: tipo, código de faena y correlativo de cuatro dígitos", () => {
    expect(formatFolio("P", "BIO", 1)).toBe("MP-BIO-0001")
    expect(formatFolio("C", "CHO", 123)).toBe("MC-CHO-0123")
    expect(formatFolio("P", "STF", 9_999)).toBe("MP-STF-9999")
  })

  it("pasado el 9999 el correlativo crece en vez de cortarse", () => {
    expect(formatFolio("P", "BIO", 12_345)).toBe("MP-BIO-12345")
  })
})

describe("deriveFolioCode", () => {
  it("toma las tres primeras letras del nombre, sin tildes", () => {
    expect(deriveFolioCode("Flor del Laja", new Set())).toBe("FLO")
    expect(deriveFolioCode("Pacífico", new Set())).toBe("PAC")
    expect(deriveFolioCode("Ñuble", new Set())).toBe("NUB")
    expect(deriveFolioCode("Fab. Puertas", new Set())).toBe("FAB")
    expect(deriveFolioCode("Calymag", new Set())).toBe("CAL")
  })

  it("si está tomado prueba las iniciales de las palabras", () => {
    expect(deriveFolioCode("Flor del Laja", new Set(["FLO"]))).toBe("FDL")
  })

  it("si también está tomado, varía la tercera letra", () => {
    expect(deriveFolioCode("Cabrero", new Set(["CAB"]))).toBe("CAR")
    expect(deriveFolioCode("Cabrero", new Set(["CAB", "CAR"]))).toBe("CAE")
  })

  it("con un nombre demasiado corto o sin letras igual produce tres letras libres", () => {
    expect(deriveFolioCode("Al", new Set())).toMatch(/^A[A-Z]{2}$/)
    expect(deriveFolioCode("123", new Set())).toMatch(/^F[A-Z]{2}$/)
  })

  it("nunca repite un código tomado y siempre da tres letras mayúsculas", () => {
    const taken = new Set<string>()
    for (const name of ["Santa Fe", "Santa Fe Sur", "Santa Fe Norte", "Santa Fe Alto", "Santa Fe Bajo", "Sanatorio", "Santiago"]) {
      const code = deriveFolioCode(name, taken)
      expect(code).toMatch(/^[A-Z]{3}$/)
      expect(taken.has(code), code).toBe(false)
      taken.add(code)
    }
  })
})

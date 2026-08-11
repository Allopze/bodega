import { describe, it, expect } from "vitest"
import { normalizeFolio, folioRutKey } from "../folio-match"

describe("normalizeFolio", () => {
  it("deja el folio del DTE tal cual cuando ya viene limpio", () => {
    expect(normalizeFolio(45678)).toBe("45678")
    expect(normalizeFolio("45678")).toBe("45678")
  })

  // Estos son los casos por los que una factura tipeada a mano nunca cruzaba.
  it.each([
    ["ceros a la izquierda", "0045678"],
    ["separador de miles", "45.678"],
    ["prefijo de serie", "F-45678"],
    ["rótulo copiado", "N° 45678"],
    ["espacios del pegado", "  45678  "],
    ["mezcla", "Factura N° 0045.678"],
  ])("cruza pese a %s", (_caso, escrito) => {
    expect(normalizeFolio(escrito)).toBe(normalizeFolio(45678))
  })

  it("no cruza folios distintos: el falso positivo cuesta más que el falso negativo", () => {
    expect(normalizeFolio("45679")).not.toBe(normalizeFolio(45678))
    // Un dígito extra al final es otro documento, no el mismo con ruido.
    expect(normalizeFolio("456780")).not.toBe(normalizeFolio(45678))
  })

  it("devuelve cadena vacía cuando no queda nada comparable", () => {
    expect(normalizeFolio("")).toBe("")
    expect(normalizeFolio("   ")).toBe("")
    expect(normalizeFolio("sin número")).toBe("")
    expect(normalizeFolio(null)).toBe("")
    expect(normalizeFolio(undefined)).toBe("")
    // Un talonario en cero se reduce a vacío: no es una clave válida.
    expect(normalizeFolio("000")).toBe("")
  })
})

describe("folioRutKey", () => {
  it("exige folio y RUT juntos: el folio no es único entre proveedores", () => {
    expect(folioRutKey("0045678", "76987654-3")).toBe("45678|76987654-3")
    expect(folioRutKey(45678, "76987654-3")).not.toBe(folioRutKey(45678, "96542490-3"))
  })
})

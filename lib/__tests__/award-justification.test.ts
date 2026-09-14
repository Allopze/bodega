/**
 * `COT-002` (auditoría 2026-09-14): al adjudicar viajaban dos identificadores y
 * nada más. La decisión guardaba «Cotización seleccionada: …», que prueba cuál
 * oferta se marcó y no por qué. No había forma de distinguir una elección por
 * plazo o calidad de una equivocación.
 */
import { describe, expect, it } from "vitest"
import {
  AwardJustificationRequired, cheapestOffer, describeAwardDecision,
  requiresAwardJustification, validateAwardJustification,
} from "@/lib/requests/award-justification"

const OFERTAS = [
  { id: "q-barata", totalAmount: 100000 },
  { id: "q-media",  totalAmount: 150000 },
  { id: "q-cara",   totalAmount: 200000 },
]

describe("cuándo hay que explicar la elección", () => {
  it("adjudicar la más económica no exige explicación", () => {
    expect(requiresAwardJustification("q-barata", OFERTAS)).toBe(false)
  })

  it("adjudicar cualquier otra sí, porque es la excepción", () => {
    expect(requiresAwardJustification("q-media", OFERTAS)).toBe(true)
    expect(requiresAwardJustification("q-cara", OFERTAS)).toBe(true)
  })

  it("con una sola oferta no hay elección que justificar", () => {
    expect(requiresAwardJustification("q-unica", [{ id: "q-unica", totalAmount: 100000 }])).toBe(false)
    expect(cheapestOffer([{ id: "q-unica", totalAmount: 1 }])).toBeNull()
  })

  it("un empate en el precio más bajo no es una excepción", () => {
    const empate = [{ id: "q-a", totalAmount: 100000 }, { id: "q-b", totalAmount: 100000 }]
    expect(requiresAwardJustification("q-b", empate)).toBe(false)
  })

  it("con importes ilegibles no afirma que exista una más barata", () => {
    const rotas = [{ id: "q-a", totalAmount: null }, { id: "q-b", totalAmount: "no es un número" }]
    expect(requiresAwardJustification("q-a", rotas)).toBe(false)
  })

  it("lee el importe venga como número o como texto de la base", () => {
    const texto = [{ id: "q-a", totalAmount: "100000" }, { id: "q-b", totalAmount: "150000" }]
    expect(requiresAwardJustification("q-b", texto)).toBe(true)
    expect(requiresAwardJustification("q-a", texto)).toBe(false)
  })
})

describe("la política al validar", () => {
  it("rechaza la adjudicación excepcional sin fundamento", () => {
    expect(() => validateAwardJustification("q-cara", OFERTAS, null))
      .toThrow(AwardJustificationRequired)
    expect(() => validateAwardJustification("q-cara", OFERTAS, "   "))
      .toThrow(/no es la más económica/)
  })

  it("rechaza el fundamento que es un trámite, no una explicación", () => {
    expect(() => validateAwardJustification("q-cara", OFERTAS, "ok")).toThrow(/10 caracteres/)
  })

  it("acepta y sanea el fundamento suficiente", () => {
    expect(validateAwardJustification("q-cara", OFERTAS, "  Entrega en 48h contra 3 semanas  "))
      .toBe("Entrega en 48h contra 3 semanas")
  })

  it("no exige nada al adjudicar la más económica, pero guarda lo que se escriba", () => {
    expect(validateAwardJustification("q-barata", OFERTAS, null)).toBeNull()
    expect(validateAwardJustification("q-barata", OFERTAS, "La más barata y con stock")).toBe("La más barata y con stock")
  })

  it("un fundamento voluntario tampoco puede ser una letra suelta", () => {
    expect(() => validateAwardJustification("q-barata", OFERTAS, ".")).toThrow(AwardJustificationRequired)
  })
})

describe("lo que queda escrito en la decisión", () => {
  it("conserva la identidad de la oferta y añade el fundamento", () => {
    expect(describeAwardDecision("Ferretería del sur", "Entrega en 48h"))
      .toBe("Cotización seleccionada: Ferretería del sur. Fundamento: Entrega en 48h")
  })

  it("sin fundamento dice exactamente lo que decía antes", () => {
    expect(describeAwardDecision("Ferretería del sur", null))
      .toBe("Cotización seleccionada: Ferretería del sur")
  })
})

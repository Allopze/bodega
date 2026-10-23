import { describe, expect, it } from "vitest"
import { resolveNextExpiryDate } from "@/lib/validation/fleet-documents"

/**
 * Único criterio de «próximo vencimiento» de un equipo: lo comparten la lista y
 * la ficha de Flota (`lib/services/fleet.ts`) y los conteos de «Requiere
 * atención» del Panel operacional. Estas pruebas lo fijan en un solo lugar.
 */

describe("resolveNextExpiryDate", () => {
  it("devuelve la menor de las columnas declaradas", () => {
    expect(resolveNextExpiryDate({
      soapExpiresAt: "2026-09-01",
      technicalReviewExpiresAt: "2026-08-15",
      circulationPermitExpiresAt: "2027-03-31",
      insuranceExpiresAt: "2026-07-20",
    }, [])).toBe("2026-07-20")
  })

  it("sin ninguna fecha devuelve null", () => {
    expect(resolveNextExpiryDate({}, [])).toBeNull()
    expect(resolveNextExpiryDate({ soapExpiresAt: null, insuranceExpiresAt: null }, [])).toBeNull()
  })

  it("el documento vigente aporta su fecha cuando la columna del mismo tipo está vacía", () => {
    expect(resolveNextExpiryDate(
      { soapExpiresAt: "2027-01-01" },
      [{ documentType: "Seguro", expiresAt: "2026-09-30" }],
    )).toBe("2026-09-30")
  })

  it("la columna declarada manda sobre el documento del mismo tipo", () => {
    expect(resolveNextExpiryDate(
      { soapExpiresAt: "2027-06-01" },
      [{ documentType: "SOAP", expiresAt: "2026-01-01" }],
    )).toBe("2027-06-01")
  })

  it("un documento sin columna propia (Padrón) cuenta sólo si trae fecha", () => {
    expect(resolveNextExpiryDate({}, [{ documentType: "Padrón", expiresAt: null }])).toBeNull()
    expect(resolveNextExpiryDate({}, [{ documentType: "Padrón", expiresAt: "2026-12-31" }])).toBe("2026-12-31")
  })
})

import { describe, expect, it } from "vitest"
import { buildPdtpProgramHref, resolvePdtpYear, resolveSelectedWorksiteId } from "./pdtp-context"

describe("PDTP context", () => {
  it("usa año calendario y descarta parámetros inválidos", () => {
    expect(resolvePdtpYear("2027", 2026)).toBe(2027)
    expect(resolvePdtpYear("sin-año", 2026)).toBe(2026)
    expect(resolvePdtpYear("2101", 2026)).toBe(2026)
  })

  it("preserva el contexto compatible al abrir un programa", () => {
    expect(buildPdtpProgramHref("programa-1", {
      anio: "2026", hoja: "pdtp_general", faena: "faena-1", vista: "semana",
    })).toBe("/prevencion/pdtp/programa-1?hoja=pdtp_general&faena=faena-1&vista=semana")
  })

  it("solo elige la faena automáticamente cuando es la única disponible", () => {
    expect(resolveSelectedWorksiteId(undefined, [{ id: "faena-1" }])).toBe("faena-1")
    expect(resolveSelectedWorksiteId(undefined, [{ id: "faena-1" }, { id: "faena-2" }])).toBeUndefined()
    expect(resolveSelectedWorksiteId("faena-2", [{ id: "faena-1" }, { id: "faena-2" }])).toBe("faena-2")
  })
})

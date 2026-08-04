import { describe, expect, it } from "vitest"
import { buildPdtpActivitiesHref, buildPdtpProgramHref, resolvePdtpActivitiesReturnHref, resolvePdtpYear, resolveSelectedWorksiteId } from "./pdtp-context"

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

  it("conserva programa, período y filtros al volver al visor después de corregirlo", () => {
    const href = buildPdtpActivitiesHref({
      programa: "programa-1", anio: "2026", hoja: "pdtp_general", faena: "faena-1", vista: "semana", estado: "pending", mes: 7, semana: 2,
    })
    expect(href).toBe("/prevencion/pdtp/actividades?programa=programa-1&hoja=pdtp_general&faena=faena-1&vista=semana&anio=2026&estado=pending&mes=7&semana=2")
    expect(resolvePdtpActivitiesReturnHref(href)).toBe(href)
  })

  it("solo acepta retornos internos hacia Actividades PDTP", () => {
    expect(resolvePdtpActivitiesReturnHref("https://example.com")).toBeUndefined()
    expect(resolvePdtpActivitiesReturnHref("/prevencion/pdtp/programa-1")).toBeUndefined()
  })

  it("solo elige la faena automáticamente cuando es la única disponible", () => {
    expect(resolveSelectedWorksiteId(undefined, [{ id: "faena-1" }])).toBe("faena-1")
    expect(resolveSelectedWorksiteId(undefined, [{ id: "faena-1" }, { id: "faena-2" }])).toBeUndefined()
    expect(resolveSelectedWorksiteId("faena-2", [{ id: "faena-1" }, { id: "faena-2" }])).toBe("faena-2")
  })
})

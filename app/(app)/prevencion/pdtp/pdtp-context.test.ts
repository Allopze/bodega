import { describe, expect, it } from "vitest"
import { buildPdtpActivitiesHref, buildPdtpMonthlyTrend, buildPdtpProgramHref, resolvePdtpActivitiesReturnHref, resolvePdtpYear, resolveSelectedWorksiteId, withYearCloseDeactivatedWorksites } from "./pdtp-context"

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

  it("conserva el filtro de objetivo al construir el href de Actividades", () => {
    const href = buildPdtpActivitiesHref({ programa: "programa-1", objetivo: "objective-1" })
    expect(href).toBe("/prevencion/pdtp/actividades?programa=programa-1&objetivo=objective-1")
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

  it("suma las faenas dadas de baja con meses por cerrar, dentro del alcance y rotuladas", () => {
    const missing = [
      { worksiteId: "faena-1", worksiteName: "Faena 1", months: [12] },
      { worksiteId: "faena-baja", worksiteName: "Faena Baja", worksiteCode: "FB", months: [5], deactivated: true as const },
      { worksiteId: "faena-ajena", worksiteName: "Faena Ajena", worksiteCode: "FA", months: [5], deactivated: true as const },
    ]
    expect(withYearCloseDeactivatedWorksites([{ id: "faena-1", name: "Faena 1", code: "F1" }], missing, ["faena-1", "faena-baja"]))
      .toEqual([{ id: "faena-1", name: "Faena 1", code: "F1" }, { id: "faena-baja", name: "Faena Baja (dada de baja)", code: "FB" }])
    expect(withYearCloseDeactivatedWorksites([{ id: "faena-1", name: "Faena 1", code: "F1" }], missing, "all")).toHaveLength(3)
    expect(withYearCloseDeactivatedWorksites([{ id: "faena-1", name: "Faena 1", code: "F1" }], null, "all")).toHaveLength(1)
  })
})

/**
 * Fase 0.4 (AUDITORIA_VISUALIZACIONES_CHOME, CHART-004): la página convertía el
 * `null` del % mensual en 0, así que un mes sin plan se leía como «0 % de
 * cumplimiento».
 */
describe("buildPdtpMonthlyTrend", () => {
  const month = (m: number, planned: number, executed: number, percent: number | null) => ({ month: m, planned, executed, percent })

  it("un mes sin actividades programadas queda en null, no en 0 %", () => {
    const [sinPlan] = buildPdtpMonthlyTrend([month(1, 0, 0, null)])

    expect(sinPlan).toEqual({ monthName: "Ene", scheduled: 0, executed: 0, compliancePercent: null })
  })

  it("distingue «sin plan» (null) de «con plan y 0 ejecutadas» (0 %)", () => {
    const [sinPlan, conPlanSinEjecutar] = buildPdtpMonthlyTrend([month(2, 0, 0, null), month(3, 4, 0, 0)])

    expect(sinPlan!.compliancePercent).toBeNull()
    expect(conPlanSinEjecutar!.compliancePercent).toBe(0)
  })

  it("redondea la fracción del servicio a porcentaje entero y conserva plan y ejecutado", () => {
    const [mes] = buildPdtpMonthlyTrend([month(4, 3, 2, 0.6667)])

    expect(mes).toEqual({ monthName: "Abr", scheduled: 3, executed: 2, compliancePercent: 67 })
  })
})

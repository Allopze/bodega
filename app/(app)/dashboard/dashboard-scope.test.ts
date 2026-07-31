import { describe, expect, it } from "vitest"
import type { WorksiteScope } from "@/lib/auth/scope"
import {
  dashboardScopeHref,
  intersectWorksiteScope,
  parseDashboardScope,
  scopedWorksiteId,
} from "./dashboard-scope"

const WORKSITES = [
  { id: "ws-norte", name: "Faena Norte" },
  { id: "ws-sur", name: "Faena Sur" },
]

describe("parseDashboardScope", () => {
  it("resuelve faena y período válidos", () => {
    const scope = parseDashboardScope({ faena: "ws-sur", periodo: "trimestre" }, WORKSITES)
    expect(scope).toEqual({ worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "trimestre" })
  })

  it("cae a todas las faenas y al mes sin parámetros", () => {
    const scope = parseDashboardScope({}, WORKSITES)
    expect(scope).toEqual({ worksiteId: "all", worksiteName: null, period: "mes" })
  })

  it("descarta una faena no autorizada en vez de dejar el tablero en cero", () => {
    const scope = parseDashboardScope({ faena: "ws-ajena" }, WORKSITES)
    expect(scope.worksiteId).toBe("all")
    expect(scope.worksiteName).toBeNull()
  })

  it("descarta un período inventado", () => {
    expect(parseDashboardScope({ periodo: "decada" }, WORKSITES).period).toBe("mes")
  })

  it("toma el primer valor si el parámetro viene repetido", () => {
    const scope = parseDashboardScope({ faena: ["ws-norte", "ws-sur"], periodo: ["anio", "mes"] }, WORKSITES)
    expect(scope.worksiteId).toBe("ws-norte")
    expect(scope.period).toBe("anio")
  })

  it("sin faenas autorizadas no resuelve ninguna", () => {
    expect(parseDashboardScope({ faena: "ws-norte" }, []).worksiteId).toBe("all")
  })
})

describe("scopedWorksiteId", () => {
  it("traduce 'all' a undefined para que las consultas no filtren de más", () => {
    expect(scopedWorksiteId({ worksiteId: "all", worksiteName: null, period: "mes" })).toBeUndefined()
    expect(scopedWorksiteId({ worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "mes" })).toBe("ws-sur")
  })
})

describe("intersectWorksiteScope", () => {
  const scope = (worksiteId: string) => ({ worksiteId, worksiteName: null, period: "mes" as const })

  it("acota un rol global a la faena elegida", () => {
    expect(intersectWorksiteScope({ mode: "all", ids: [] }, scope("ws-sur")))
      .toEqual({ mode: "some", ids: ["ws-sur"] })
  })

  it("acota un rol de faena a la elegida cuando la tiene autorizada", () => {
    expect(intersectWorksiteScope({ mode: "some", ids: ["ws-norte", "ws-sur"] }, scope("ws-sur")))
      .toEqual({ mode: "some", ids: ["ws-sur"] })
  })

  // La regla de seguridad del módulo: elegir una faena nunca amplía el alcance.
  it("no amplía el alcance a una faena fuera del permiso", () => {
    expect(intersectWorksiteScope({ mode: "some", ids: ["ws-norte"] }, scope("ws-sur")))
      .toEqual({ mode: "none", ids: [] })
  })

  it("deja el alcance intacto con 'all'", () => {
    const base: WorksiteScope = { mode: "some", ids: ["ws-norte"] }
    expect(intersectWorksiteScope(base, { worksiteId: "all", worksiteName: null, period: "mes" })).toBe(base)
  })

  it("un alcance vacío sigue vacío al elegir faena", () => {
    expect(intersectWorksiteScope({ mode: "none", ids: [] }, scope("ws-sur")))
      .toEqual({ mode: "none", ids: [] })
  })
})

describe("dashboardScopeHref", () => {
  const base = { worksiteId: "all", worksiteName: null, period: "mes" as const }

  it("omite los valores por defecto para no ensuciar la URL", () => {
    expect(dashboardScopeHref(base, {})).toBe("/dashboard")
  })

  it("conserva la dimensión que no cambia", () => {
    const withWorksite = { ...base, worksiteId: "ws-sur", worksiteName: "Faena Sur" }
    expect(dashboardScopeHref(withWorksite, { period: "anio" })).toBe("/dashboard?faena=ws-sur&periodo=anio")
  })

  it("quita el parámetro al volver a todas las faenas", () => {
    const withWorksite = { ...base, worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "anio" as const }
    expect(dashboardScopeHref(withWorksite, { worksiteId: "all" })).toBe("/dashboard?periodo=anio")
  })
})

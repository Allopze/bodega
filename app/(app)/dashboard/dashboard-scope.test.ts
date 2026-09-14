import { describe, expect, it } from "vitest"
import type { WorksiteScope } from "@/lib/auth/scope"
import {
  dashboardScopeHref,
  intersectWorksiteScope,
  parseDashboardScope,
  periodWindowHref,
  scopedWorksiteId,
} from "./dashboard-scope"
import { availableDashboardViews } from "./dashboard-views"

const WORKSITES = [
  { id: "ws-norte", name: "Faena Norte" },
  { id: "ws-sur", name: "Faena Sur" },
]

/**
 * Perfil con dinero, cola, prevención y flota — **sin** gobernanza, que es la
 * vista que los tests usan como "existe pero no la tienes autorizada".
 */
const ALL_VIEWS = availableDashboardViews([
  "purchasing:view", "operations:view_work", "prevention:pdtp:view", "combustibles:view",
])

describe("parseDashboardScope", () => {
  it("resuelve faena y período válidos", () => {
    const scope = parseDashboardScope({ faena: "ws-sur", periodo: "trimestre" }, WORKSITES, ALL_VIEWS)
    expect(scope).toEqual({ worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "trimestre", view: "resumen" })
  })

  it("cae a todas las faenas y al mes sin parámetros", () => {
    const scope = parseDashboardScope({}, WORKSITES, ALL_VIEWS)
    expect(scope).toEqual({ worksiteId: "all", worksiteName: null, period: "mes", view: "resumen" })
  })

  it("descarta una faena no autorizada en vez de dejar el tablero en cero", () => {
    const scope = parseDashboardScope({ faena: "ws-ajena" }, WORKSITES, ALL_VIEWS)
    expect(scope.worksiteId).toBe("all")
    expect(scope.worksiteName).toBeNull()
  })

  it("descarta un período inventado", () => {
    expect(parseDashboardScope({ periodo: "decada" }, WORKSITES, ALL_VIEWS).period).toBe("mes")
  })

  it("toma el primer valor si el parámetro viene repetido", () => {
    const scope = parseDashboardScope({ faena: ["ws-norte", "ws-sur"], periodo: ["anio", "mes"] }, WORKSITES, ALL_VIEWS)
    expect(scope.worksiteId).toBe("ws-norte")
    expect(scope.period).toBe("anio")
  })

  it("sin faenas autorizadas no resuelve ninguna", () => {
    expect(parseDashboardScope({ faena: "ws-norte" }, [], ALL_VIEWS).worksiteId).toBe("all")
  })
})

describe("scopedWorksiteId", () => {
  it("traduce 'all' a undefined para que las consultas no filtren de más", () => {
    expect(scopedWorksiteId({ worksiteId: "all", worksiteName: null, period: "mes", view: "resumen" })).toBeUndefined()
    expect(scopedWorksiteId({ worksiteId: "ws-sur", worksiteName: "Faena Sur", period: "mes", view: "resumen" })).toBe("ws-sur")
  })
})

describe("intersectWorksiteScope", () => {
  const scope = (worksiteId: string) => ({ worksiteId, worksiteName: null, period: "mes" as const, view: "resumen" as const })

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
    expect(intersectWorksiteScope(base, { worksiteId: "all", worksiteName: null, period: "mes", view: "resumen" })).toBe(base)
  })

  it("un alcance vacío sigue vacío al elegir faena", () => {
    expect(intersectWorksiteScope({ mode: "none", ids: [] }, scope("ws-sur")))
      .toEqual({ mode: "none", ids: [] })
  })
})

describe("dashboardScopeHref", () => {
  const base = { worksiteId: "all", worksiteName: null, period: "mes" as const, view: "resumen" as const }

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

/**
 * La vista es la tercera dimensión de la URL. Vive junto a faena y período por
 * la misma razón que ellas: reencuadra consultas de **servidor**, y un Server
 * Component sólo reconsulta si el valor viaja en la URL.
 */
describe("la vista viaja en la URL", () => {
  it("lee `?vista=` cuando el rol la tiene autorizada", () => {
    expect(parseDashboardScope({ vista: "flota" }, WORKSITES, ALL_VIEWS).view).toBe("flota")
  })

  it("una vista no autorizada cae al Resumen sin tocar faena ni período", () => {
    const scope = parseDashboardScope(
      { vista: "gobernanza", faena: "ws-sur", periodo: "anio" }, WORKSITES, ALL_VIEWS,
    )
    expect(scope.view).toBe("resumen")
    expect(scope.worksiteId).toBe("ws-sur")
    expect(scope.period).toBe("anio")
  })

  it("cambiar de vista conserva faena y período: el alcance no se reinicia al navegar", () => {
    const scope = parseDashboardScope(
      { vista: "resumen", faena: "ws-sur", periodo: "anio" }, WORKSITES, ALL_VIEWS,
    )
    expect(dashboardScopeHref(scope, { view: "adquisiciones" }))
      .toBe("/dashboard?vista=adquisiciones&faena=ws-sur&periodo=anio")
  })

  it("cambiar de faena conserva la vista", () => {
    const scope = parseDashboardScope({ vista: "flota" }, WORKSITES, ALL_VIEWS)
    expect(dashboardScopeHref(scope, { worksiteId: "ws-norte" }))
      .toBe("/dashboard?vista=flota&faena=ws-norte")
  })

  it("el Resumen es el defecto y no ensucia la URL", () => {
    const scope = parseDashboardScope({}, WORKSITES, ALL_VIEWS)
    expect(scope.view).toBe("resumen")
    expect(dashboardScopeHref(scope, {})).toBe("/dashboard")
  })

  it("toma el primer valor si `vista` viene repetida", () => {
    expect(parseDashboardScope({ vista: ["trabajo", "flota"] }, WORKSITES, ALL_VIEWS).view).toBe("trabajo")
  })
})

/**
 * DASH-002 (auditoría 2026-09-14): los KPI de período (Solicitudes creadas, OC
 * emitidas, Inversión) contaban la faena elegida pero abrían la lista con sólo
 * `desde` y `hasta`. El destino perdía la faena y podía mostrar una población
 * más amplia que la cifra pulsada.
 *
 * `pendientesHref` ya conservaba el alcance; estas pruebas fijan que el helper
 * de ventana temporal haga lo mismo. Antes del arreglo el href era
 * `/compras?desde=…&hasta=…` sin `faena`.
 */
describe("periodWindowHref (DASH-002)", () => {
  // 2026-05-20 en Chile: mes = mayo, trimestre = abr-jun, año = 2026.
  const NOW = new Date("2026-05-20T15:00:00Z")

  it("propaga la faena elegida al destino, junto con la ventana del período", () => {
    const scope = parseDashboardScope({ faena: "ws-sur" }, WORKSITES, ALL_VIEWS)
    const href = periodWindowHref(scope, "/compras", NOW)
    const params = new URLSearchParams(href.split("?")[1])

    expect(href.startsWith("/compras?")).toBe(true)
    expect(params.get("faena")).toBe("ws-sur")
    expect(params.get("desde")).toBe("2026-05-01")
    expect(params.get("hasta")).toBe("2026-06-01")
  })

  it("con alcance «todas» no inventa un filtro de faena", () => {
    const scope = parseDashboardScope({}, WORKSITES, ALL_VIEWS)
    expect(periodWindowHref(scope, "/solicitudes", NOW))
      .toBe("/solicitudes?desde=2026-05-01&hasta=2026-06-01")
  })

  it("la ventana sigue al período elegido y la faena se conserva igual", () => {
    const trimestre = parseDashboardScope({ faena: "ws-norte", periodo: "trimestre" }, WORKSITES, ALL_VIEWS)
    expect(periodWindowHref(trimestre, "/compras", NOW))
      .toBe("/compras?desde=2026-04-01&hasta=2026-07-01&faena=ws-norte")

    const anio = parseDashboardScope({ faena: "ws-norte", periodo: "anio" }, WORKSITES, ALL_VIEWS)
    expect(periodWindowHref(anio, "/compras", NOW))
      .toBe("/compras?desde=2026-01-01&hasta=2027-01-01&faena=ws-norte")
  })

  it("una faena no autorizada cae a «todas» y tampoco viaja en el href", () => {
    const scope = parseDashboardScope({ faena: "ws-ajena" }, WORKSITES, ALL_VIEWS)
    expect(periodWindowHref(scope, "/compras", NOW)).not.toContain("faena=")
  })
})

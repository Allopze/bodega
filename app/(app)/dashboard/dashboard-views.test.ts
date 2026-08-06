import { describe, expect, it } from "vitest"
import {
  availableDashboardViews,
  DEFAULT_DASHBOARD_VIEW,
  isDomainView,
  parseDashboardView,
} from "./dashboard-views"

/**
 * Las vistas son la tercera dimensión de la URL, junto a faena y período. El
 * gating es el mismo de los dominios: sin permiso, la pestaña no existe — no
 * basta con esconder su contenido, porque el `?vista=` es escribible a mano.
 */

const JEFATURA = [
  "requests:view_all", "purchasing:view", "approvals:approve", "receiving:view",
  "warehouse:view_stock", "deliveries:view", "operations:view_work",
  "prevention:pdtp:view", "prevention:incidents:view", "prevention:capa:view",
  "combustibles:view", "flota:view", "mantenciones:view",
  "prevention:docs:view", "ppa:view",
]

const SOLICITANTE = ["requests:view_own"]

describe("availableDashboardViews", () => {
  it("Resumen siempre existe, aunque el rol no tenga ningún dominio", () => {
    const keys = availableDashboardViews([]).map((view) => view.key)
    expect(keys).toEqual(["resumen"])
  })

  it("Mi trabajo aparece sólo con `operations:view_work`", () => {
    expect(availableDashboardViews(SOLICITANTE).map((v) => v.key)).not.toContain("trabajo")
    expect(availableDashboardViews([...SOLICITANTE, "operations:view_work"]).map((v) => v.key))
      .toContain("trabajo")
  })

  it("los dominios llegan en el orden que decide el perfil de permisos", () => {
    const keys = availableDashboardViews(JEFATURA).map((view) => view.key)
    expect(keys.slice(0, 2)).toEqual(["resumen", "trabajo"])
    // `purchasing:view` manda la plata al frente.
    expect(keys[2]).toBe("finanzas")
  })

  it("cada pestaña declara un rótulo corto: los títulos largos no caben en la barra", () => {
    for (const view of availableDashboardViews(JEFATURA)) {
      expect(view.title.length).toBeLessThanOrEqual(16)
    }
  })
})

describe("parseDashboardView", () => {
  const available = availableDashboardViews(JEFATURA)

  it("acepta una vista autorizada", () => {
    expect(parseDashboardView("adquisiciones", available)).toBe("adquisiciones")
  })

  it("una vista desconocida cae al Resumen en vez de dejar la página en blanco", () => {
    expect(parseDashboardView("contabilidad", available)).toBe(DEFAULT_DASHBOARD_VIEW)
  })

  it("una vista real pero NO autorizada cae al Resumen: el `?vista=` es escribible a mano", () => {
    const solicitante = availableDashboardViews(SOLICITANTE)
    expect(parseDashboardView("prevencion", solicitante)).toBe("resumen")
  })

  it("sin parámetro, Resumen", () => {
    expect(parseDashboardView(undefined, available)).toBe("resumen")
  })
})

describe("isDomainView", () => {
  it("separa las dos vistas propias de las de dominio", () => {
    expect(isDomainView("resumen")).toBe(false)
    expect(isDomainView("trabajo")).toBe(false)
    expect(isDomainView("finanzas")).toBe(true)
  })
})

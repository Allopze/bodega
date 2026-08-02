import { describe, expect, it } from "vitest"
import { DASHBOARD_DOMAINS, domainIsVisible, orderDashboardDomains } from "./dashboard-domains"

/**
 * El orden lo decide el **perfil de permisos**, no el slug del rol: los slugs se
 * editan en `/admin/roles` y la pantalla no puede depender de esa lista.
 */

// Permisos reales de `jefa_chome` que tocan el tablero (modules/*/manifest.ts).
const JEFATURA = [
  "requests:view_all", "purchasing:view", "approvals:approve", "receiving:view",
  "warehouse:view_stock", "deliveries:view",
  "prevention:pdtp:view", "prevention:incidents:view", "prevention:capa:view",
  "prevention:indicadores:view", "prevention:legal:view",
  "prevention:docs:view", "prevention:training:view", "ppa:view",
  "combustibles:view", "flota:view", "mantenciones:view",
  "prevention:inspections:view", "prevention:permits:view", "prevention:cphs:view",
]

const PREVENCIONISTA_FAENA = [
  "prevention:pdtp:view", "prevention:capa:view", "prevention:epp:view",
  "prevention:inspections:view", "warehouse:view_stock", "receiving:view",
]

const SOLICITANTE = ["requests:view_own"]

describe("orderDashboardDomains", () => {
  it("a quien mira la plata le abre con gasto: Adquisiciones y Flota primero", () => {
    const keys = orderDashboardDomains(JEFATURA).map((domain) => domain.key)
    expect(keys).toEqual(["adquisiciones", "flota", "prevencion", "bodega", "terreno", "gobernanza"])
  })

  it("sin permiso de compras abre por prevención", () => {
    const keys = orderDashboardDomains(PREVENCIONISTA_FAENA).map((domain) => domain.key)
    expect(keys[0]).toBe("prevencion")
    expect(keys).not.toContain("flota")
  })

  // Ordena, no decide visibilidad: eso ya lo hizo `domainIsVisible`.
  it("omite los dominios que el rol no puede ver", () => {
    const keys = orderDashboardDomains(SOLICITANTE).map((domain) => domain.key)
    expect(keys).toEqual(["adquisiciones"])
  })

  it("sin permisos no hay secciones", () => {
    expect(orderDashboardDomains([])).toEqual([])
  })

  it("`purchasing:view` es lo único que cambia el orden entre dos perfiles iguales", () => {
    const base = ["requests:view_all", "prevention:pdtp:view", "combustibles:view", "warehouse:view_stock"]
    const sinPlata = orderDashboardDomains(base).map((d) => d.key)
    const conPlata = orderDashboardDomains([...base, "purchasing:view"]).map((d) => d.key)

    expect(sinPlata[0]).toBe("prevencion")
    expect(conPlata[0]).toBe("adquisiciones")
    // Mismos dominios, distinto orden.
    expect([...sinPlata].sort()).toEqual([...conPlata].sort())
  })
})

describe("domainIsVisible", () => {
  it("basta un permiso del dominio", () => {
    expect(domainIsVisible(DASHBOARD_DOMAINS.flota, ["mantenciones:view"])).toBe(true)
    expect(domainIsVisible(DASHBOARD_DOMAINS.flota, ["requests:view_own"])).toBe(false)
  })

  it("cada dominio declara al menos un permiso, o sería invisible siempre", () => {
    for (const domain of Object.values(DASHBOARD_DOMAINS)) {
      expect(domain.permissions.length).toBeGreaterThan(0)
    }
  })

  it("las anclas son únicas: el índice navega por ellas", () => {
    const anchors = Object.values(DASHBOARD_DOMAINS).map((d) => d.anchor)
    expect(new Set(anchors).size).toBe(anchors.length)
  })
})

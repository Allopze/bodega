import { describe, expect, it } from "vitest"
import {
  availableDashboardViews,
  DEFAULT_DASHBOARD_VIEW,
  isDomainView,
  DASHBOARD_VIEW_KEYS,
  parseDashboardView,
  viewRespondsToPeriod,
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

  // "Mi trabajo" se retiró: su lugar es el bloque "Hoy" del Resumen y la cola
  // completa vive en /pendientes. Ni siquiera con el permiso reaparece.
  it("ya no hay vista Mi trabajo, ni con `operations:view_work`", () => {
    expect(DASHBOARD_VIEW_KEYS).not.toContain("trabajo")
    expect(availableDashboardViews([...SOLICITANTE, "operations:view_work"]).map((v) => v.key))
      .not.toContain("trabajo")
    expect(parseDashboardView("trabajo", availableDashboardViews(JEFATURA))).toBe("resumen")
  })

  it("los dominios llegan en el orden que decide el perfil de permisos", () => {
    const keys = availableDashboardViews(JEFATURA).map((view) => view.key)
    expect(keys[0]).toBe("resumen")
    // `purchasing:view` manda la plata al frente.
    expect(keys[1]).toBe("finanzas")
  })

  it("cada vista declara una descripción de una línea para el menú Por área", () => {
    for (const view of availableDashboardViews(JEFATURA)) {
      expect(view.description.length, view.key).toBeGreaterThan(10)
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
  it("separa la vista propia de las de dominio", () => {
    expect(isDomainView("resumen")).toBe(false)
    expect(isDomainView("finanzas")).toBe(true)
  })
})

// INI-05: el selector de período sólo se muestra donde alguna cifra responde.
describe("viewRespondsToPeriod", () => {
  it("decide todas las vistas: ninguna queda sin entrada en la tabla", () => {
    for (const view of DASHBOARD_VIEW_KEYS) {
      expect(typeof viewRespondsToPeriod(view, JEFATURA)).toBe("boolean")
    }
  })

  it("Resumen y los dominios con consultas por período responden", () => {
    for (const view of ["resumen", "finanzas", "adquisiciones", "bodega", "terreno"] as const) {
      expect(viewRespondsToPeriod(view, JEFATURA)).toBe(true)
    }
  })

  it("Prevención y Gobernanza son estado de hoy: el selector no aplica", () => {
    for (const view of ["prevencion", "gobernanza"] as const) {
      expect(viewRespondsToPeriod(view, JEFATURA)).toBe(false)
    }
  })

  it("Flota responde sólo si el rol ve la tarjeta TAE, la única cifra que sigue al período", () => {
    expect(viewRespondsToPeriod("flota", JEFATURA)).toBe(false)
    expect(viewRespondsToPeriod("flota", [...JEFATURA, "combustibles:tae_view"])).toBe(true)
  })
})

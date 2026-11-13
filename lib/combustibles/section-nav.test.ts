import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { ajustesNavItems, cargasNavItems, consumoNavItems, cuadraturaNavItems, fuelAddDataOptions, type FuelAddDataKind } from "./section-nav"

function sessionWith(permissions: string[], isGlobal = true) {
  return { user: { id: "custom-role", permissions, isGlobal, worksiteIds: [] } } as unknown as Session
}

function allowed(session: Session): Partial<Record<FuelAddDataKind, boolean>> {
  return Object.fromEntries(fuelAddDataOptions(session).map((option) => [option.kind, option.allowed]))
}

describe("fuelAddDataOptions", () => {
  it("ofrece todo a un rol global que importa, ve costos y registra", () => {
    expect(allowed(sessionWith([
      "combustibles:view", "combustibles:view_costs", "combustibles:import", "combustibles:tae_import", "combustibles:register_load",
    ]))).toEqual({ planilla: true, tarjeta: true, facturas: true, telemetria: true, surtidor: true, sellos: true, registrar: true })
  })

  it("muestra siempre las siete opciones, aunque estén deshabilitadas", () => {
    expect(fuelAddDataOptions(sessionWith(["combustibles:view"])).map((option) => option.kind))
      .toEqual(["planilla", "tarjeta", "facturas", "telemetria", "surtidor", "sellos", "registrar"])
  })

  // Cada fila del Excel de facturas crea una carga CON montos: quien importa pero
  // no ve costos (admin_contrato) conserva los importadores de consumo y no
  // recibe éste. La ruta `/api/combustibles/import` aplica el mismo contrato.
  it("no ofrece facturas sin view_costs aunque pueda importar", () => {
    expect(allowed(sessionWith(["combustibles:view", "combustibles:import"]))).toMatchObject({ tarjeta: true, telemetria: true, facturas: false })
  })

  it("no ofrece facturas con costos pero sin permiso de importar", () => {
    expect(allowed(sessionWith(["combustibles:view", "combustibles:view_costs"]))).toMatchObject({ tarjeta: false, facturas: false })
  })

  it("view_costs sin el permiso operativo de combustible tampoco alcanza", () => {
    expect(allowed(sessionWith(["combustibles:view_costs", "combustibles:import"])).facturas).toBe(false)
  })

  it("la planilla de cargas sigue siendo sólo de roles globales", () => {
    expect(allowed(sessionWith(["combustibles:view", "combustibles:view_costs", "combustibles:import"], false))).toMatchObject({ planilla: false, facturas: true })
  })

  it("el histórico de sellos pide tae_import y registrar a mano pide register_load", () => {
    expect(allowed(sessionWith(["combustibles:view", "combustibles:tae_import"]))).toMatchObject({ sellos: true, registrar: false })
    expect(allowed(sessionWith(["combustibles:view", "combustibles:register_load"]))).toMatchObject({ sellos: false, registrar: true })
  })
})

describe("rótulos de las pestañas (auditoría Control operacional, 2026-11-13)", () => {
  const labels = (items: Array<{ label: string }>) => items.map((item) => item.label)

  it("Cargas, Consumo y Cuadratura no repiten el nombre de otra pestaña ni arrastran términos viejos", () => {
    expect(labels(cargasNavItems())).toEqual(["Cargas a equipos", "Tarjetas Copec"])
    expect(labels(consumoNavItems())).toEqual(["Rendimiento", "Litros", "Motor en vacío"])
    const all = sessionWith(["combustibles:view", "combustibles:tae_view"])
    expect(labels(cuadraturaNavItems(all))).toEqual(["Por mandante", "Estanques", "Facturado y terreno", "Tarjeta y terreno", "Sellos"])
  })

  it("Ajustes titula con un sustantivo y deja la pregunta como pista, también la de las demás secciones", () => {
    const items = ajustesNavItems(sessionWith(["combustibles:manage_control", "combustibles:manage_anomaly_rules", "combustibles:tae_manage_config", "combustibles:manage_integrations"]))
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]))
    expect(byKey.medios).toMatchObject({ label: "Medios de suministro", hint: "¿Por dónde llega el combustible?" })
    expect(byKey.umbrales).toMatchObject({ label: "Umbrales de revisión", hint: "¿Cuándo una carga pide revisión?" })
    // Ningún título es una pregunta, y todo ítem lleva su pista (en móvil también se muestra).
    for (const item of items) {
      expect(item.label).not.toMatch(/[¿?]/)
      expect(item.hint, `pista de «${item.label}»`).toBeTruthy()
    }
  })
})

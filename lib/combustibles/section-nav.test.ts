import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { fuelAddDataOptions, type FuelAddDataKind } from "./section-nav"

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

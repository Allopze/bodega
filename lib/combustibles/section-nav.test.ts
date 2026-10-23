import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { fuelImportAvailability } from "./section-nav"

function sessionWith(permissions: string[], isGlobal = true) {
  return { user: { id: "custom-role", permissions, isGlobal, worksiteIds: [] } } as unknown as Session
}

describe("fuelImportAvailability", () => {
  it("ofrece las cinco entradas a un rol global con importación y costos", () => {
    expect(fuelImportAvailability(sessionWith([
      "combustibles:view", "combustibles:view_costs", "combustibles:import", "combustibles:tae_import",
    ]))).toEqual({ tct: true, operaciones: true, control: true, tae: true, facturas: true })
  })

  // Cada fila del Excel de facturas crea una carga CON montos: quien importa pero
  // no ve costos (admin_contrato) conserva los importadores de consumo y no
  // recibe éste. La ruta `/api/combustibles/import` aplica el mismo contrato.
  it("no ofrece «Cargas facturadas» sin view_costs aunque pueda importar", () => {
    expect(fuelImportAvailability(sessionWith(["combustibles:view", "combustibles:import"]))).toMatchObject({
      tct: true,
      control: true,
      facturas: false,
    })
  })

  it("no ofrece «Cargas facturadas» con costos pero sin permiso de importar", () => {
    expect(fuelImportAvailability(sessionWith(["combustibles:view", "combustibles:view_costs"]))).toMatchObject({
      tct: false,
      facturas: false,
    })
  })

  it("view_costs sin el permiso operativo de combustible tampoco alcanza", () => {
    expect(fuelImportAvailability(sessionWith(["combustibles:view_costs", "combustibles:import"])).facturas).toBe(false)
  })

  it("el log operacional sigue siendo sólo de roles globales", () => {
    const scoped = fuelImportAvailability(sessionWith(["combustibles:view", "combustibles:view_costs", "combustibles:import"], false))
    expect(scoped).toMatchObject({ operaciones: false, facturas: true })
  })
})

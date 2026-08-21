import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { assertFuelCostAccess, operationalControlCapabilities } from "@/lib/operational-control/capabilities"

function sessionWith(...permissions: string[]) {
  return { user: { id: "custom-role", permissions } } as unknown as Session
}

describe("operationalControlCapabilities", () => {
  it("no hereda capacidades entre subdominios", () => {
    expect(operationalControlCapabilities(sessionWith("flota:view"))).toEqual({
      canViewFuel: false,
      canViewTae: false,
      canViewFleet: true,
      canViewMaintenance: false,
      canViewCosts: false,
    })
  })

  it("trata costos y TAE como capacidades independientes de combustible", () => {
    expect(operationalControlCapabilities(sessionWith("combustibles:view", "combustibles:tae_view"))).toMatchObject({
      canViewFuel: true,
      canViewTae: true,
      canViewCosts: false,
    })
  })
})

describe("assertFuelCostAccess", () => {
  it("exige permiso base y permiso de costos como un par inseparable", () => {
    expect(() => assertFuelCostAccess(sessionWith("combustibles:view_costs"))).toThrow()
    expect(() => assertFuelCostAccess(sessionWith("combustibles:view"))).toThrow()
    expect(() => assertFuelCostAccess(sessionWith("combustibles:view", "combustibles:view_costs"))).not.toThrow()
  })

  it("puede exigir además alcance global para cuenta corriente", () => {
    const scoped = {
      user: { id: "scoped", permissions: ["combustibles:view", "combustibles:view_costs"], isGlobal: false, worksiteIds: ["ws-1"] },
    } as unknown as Session
    const global = {
      user: { id: "global", permissions: ["combustibles:view", "combustibles:view_costs"], isGlobal: true, worksiteIds: [] },
    } as unknown as Session

    expect(() => assertFuelCostAccess(scoped, { global: true })).toThrow()
    expect(() => assertFuelCostAccess(global, { global: true })).not.toThrow()
  })
})

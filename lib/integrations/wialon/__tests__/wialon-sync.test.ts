import { describe, expect, it } from "vitest"
import { planWialonUnits } from "../wialon-sync"
import type { WialonUnit } from "../wialon-contract"

interface VehicleRow {
  id: string
  plate: string
  code: string | null
  worksiteId: string
  meterType: string
  tankCapacityLiters: number | null
}

const vehicles: VehicleRow[] = [
  { id: "v1", plate: "ABCD-12", code: "KA-63", worksiteId: "ws-1", meterType: "odometer", tankCapacityLiters: 200 },
  { id: "v2", plate: "AB-1234", code: null, worksiteId: "ws-1", meterType: "hour_meter", tankCapacityLiters: null },
  { id: "v3", plate: "AB1234", code: null, worksiteId: "ws-2", meterType: "odometer", tankCapacityLiters: null },
]

function unit(overrides: Partial<WialonUnit> = {}): WialonUnit {
  return {
    id: "unit-1",
    name: "EXCAVADORA 01",
    sysName: null,
    groupId: null,
    uniqueId: null,
    hardwareType: null,
    customProperties: {},
    sensors: [],
    position: null,
    lastMessageParams: {},
    lastMessageAt: null,
    ...overrides,
  }
}

describe("planWialonUnits", () => {
  it("el vínculo manual manda sobre el nombre de la unidad", () => {
    const plan = planWialonUnits([unit({ name: "ABCD12" })], vehicles, new Map([["unit-1", "v2"]]))
    expect(plan.matched).toEqual([{ unit: expect.objectContaining({ id: "unit-1" }), vehicleId: "v2", reason: "link" }])
  })

  it("cruza por propiedad de patente antes que por nombre", () => {
    const plan = planWialonUnits([
      unit({ name: "CAMION 7", customProperties: { Patente: "ABCD-12" } }),
    ], vehicles, new Map())
    expect(plan.matched[0]).toMatchObject({ vehicleId: "v1", reason: "plate" })
  })

  it("cruza por código interno cuando no hay patente", () => {
    const plan = planWialonUnits([unit({ name: "KA 63" })], vehicles, new Map())
    expect(plan.matched[0]).toMatchObject({ vehicleId: "v1", reason: "text" })
  })

  it("encuentra una patente embebida en el nombre", () => {
    const plan = planWialonUnits([unit({ name: "CAMION ABCD12 · turno 2" })], vehicles, new Map())
    expect(plan.matched[0]).toMatchObject({ vehicleId: "v1", reason: "text" })
  })

  it("no elige cuando dos vehículos normalizan a la misma patente", () => {
    const plan = planWialonUnits([unit({ name: "AB1234" })], vehicles, new Map())
    expect(plan.matched).toEqual([])
    expect(plan.ambiguous).toHaveLength(1)
  })

  it("deja pendiente una unidad que no calza y nunca crea un vehículo", () => {
    const plan = planWialonUnits([unit({ name: "EXCAVADORA 01" })], vehicles, new Map())
    expect(plan.matched).toEqual([])
    expect(plan.unmatched).toHaveLength(1)
  })

  it("avisa si dos unidades apuntan al mismo vehículo", () => {
    const plan = planWialonUnits([
      unit({ id: "a", name: "ABCD12" }),
      unit({ id: "b", name: "ABCD-12" }),
    ], vehicles, new Map())
    expect(plan.matched).toHaveLength(2)
    expect(plan.duplicateVehicleWarnings).toEqual(["WIALON_DUPLICATE_UNITS:v1"])
  })
})

import { describe, expect, it } from "vitest"
import { meterSourceRef, planWialonUnits, type WialonLinkState } from "../wialon-sync"
import type { WialonUnit } from "../wialon-contract"

interface VehicleRow {
  id: string
  plate: string
  code: string | null
  serialNumber: string | null
  worksiteId: string
  meterType: string
  tankCapacityLiters: number | null
}

const vehicles: VehicleRow[] = [
  { id: "v1", plate: "ABCD-12", code: "KA-63", serialNumber: "9BWZZZ377VT004251", worksiteId: "ws-1", meterType: "odometer", tankCapacityLiters: 200 },
  { id: "v2", plate: "AB-1234", code: null, serialNumber: null, worksiteId: "ws-1", meterType: "hour_meter", tankCapacityLiters: null },
  { id: "v3", plate: "AB1234", code: null, serialNumber: null, worksiteId: "ws-2", meterType: "odometer", tankCapacityLiters: null },
  { id: "v4", plate: "XY-9999", code: null, serialNumber: "SERIE-001", worksiteId: "ws-1", meterType: "odometer", tankCapacityLiters: null },
  { id: "v5", plate: "ZZ-0001", code: null, serialNumber: "SERIE-001", worksiteId: "ws-1", meterType: "odometer", tankCapacityLiters: null },
]

const noLinks = new Map<string, WialonLinkState>()
const linked = (unitId: string, vehicleId: string) =>
  new Map<string, WialonLinkState>([[unitId, { status: "linked", vehicleId }]])

function unit(overrides: Partial<WialonUnit> = {}): WialonUnit {
  return {
    id: "unit-1",
    name: "EXCAVADORA 01",
    uniqueId: null,
    hardwareType: null,
    customProperties: {},
    counters: { mileageKm: null, engineHours: null },
    connected: null,
    profile: { registrationPlate: null, vin: null, brand: null, model: null },
    sensors: [],
    position: null,
    lastMessageParams: {},
    lastMessageAt: null,
    ...overrides,
  }
}

describe("planWialonUnits", () => {
  it("el vínculo manual manda sobre el nombre de la unidad", () => {
    const plan = planWialonUnits([unit({ name: "ABCD12" })], vehicles, linked("unit-1", "v2"))
    expect(plan.matched).toEqual([{ unit: expect.objectContaining({ id: "unit-1" }), vehicleId: "v2", reason: "link" }])
  })

  it("cruza por propiedad de patente antes que por nombre", () => {
    const plan = planWialonUnits([
      unit({ name: "CAMION 7", customProperties: { Patente: "ABCD-12" } }),
    ], vehicles, noLinks)
    expect(plan.matched[0]).toMatchObject({ vehicleId: "v1", reason: "plate" })
  })

  it("cruza por código interno cuando no hay patente", () => {
    const plan = planWialonUnits([unit({ name: "KA 63" })], vehicles, noLinks)
    expect(plan.matched[0]).toMatchObject({ vehicleId: "v1", reason: "text" })
  })

  it("encuentra una patente embebida en el nombre", () => {
    const plan = planWialonUnits([unit({ name: "CAMION ABCD12 · turno 2" })], vehicles, noLinks)
    expect(plan.matched[0]).toMatchObject({ vehicleId: "v1", reason: "text" })
  })

  it("no elige cuando dos vehículos normalizan a la misma patente", () => {
    const plan = planWialonUnits([unit({ name: "AB1234" })], vehicles, noLinks)
    expect(plan.matched).toEqual([])
    expect(plan.ambiguous).toHaveLength(1)
  })

  it("deja pendiente una unidad que no calza y nunca crea un vehículo", () => {
    const plan = planWialonUnits([unit({ name: "EXCAVADORA 01" })], vehicles, noLinks)
    expect(plan.matched).toEqual([])
    expect(plan.unmatched).toHaveLength(1)
  })

  it("avisa si dos unidades apuntan al mismo vehículo", () => {
    const plan = planWialonUnits([
      unit({ id: "a", name: "ABCD12" }),
      unit({ id: "b", name: "ABCD-12" }),
    ], vehicles, noLinks)
    expect(plan.matched).toHaveLength(2)
    expect(plan.duplicateVehicleWarnings).toEqual(["WIALON_DUPLICATE_UNITS:v1"])
  })
  it("la patente del perfil manda sobre las propiedades internas y sobre el nombre", () => {
    const plan = planWialonUnits([
      unit({
        name: "KA 63",
        profile: { registrationPlate: "ABCD-12", vin: null, brand: null, model: null },
        customProperties: { patente: "XY-9999" },
      }),
    ], vehicles, noLinks)
    expect(plan.matched[0]).toMatchObject({ vehicleId: "v1", reason: "plate" })
  })

  it("una unidad excluida no se cruza ni cuenta como pendiente", () => {
    const plan = planWialonUnits([unit({ name: "ABCD12" })], vehicles, new Map([["unit-1", { status: "excluded", vehicleId: null }]]))
    expect(plan.matched).toEqual([])
    expect(plan.unmatched).toEqual([])
    expect(plan.ambiguous).toEqual([])
    expect(plan.excluded).toHaveLength(1)
  })

  it("el vínculo manual gana sobre la exclusión de otra unidad, no al revés", () => {
    const plan = planWialonUnits([
      unit({ id: "a", name: "ABCD12" }),
      unit({ id: "b", name: "ABCD-12" }),
    ], vehicles, new Map<string, WialonLinkState>([
      ["a", { status: "linked", vehicleId: "v2" }],
      ["b", { status: "excluded", vehicleId: null }],
    ]))
    expect(plan.matched).toEqual([expect.objectContaining({ vehicleId: "v2", reason: "link" })])
    expect(plan.excluded.map((entry) => entry.id)).toEqual(["b"])
  })

  it("cruza por VIN contra el número de serie cuando no hay patente", () => {
    const plan = planWialonUnits([
      unit({ name: "CAMION 9", profile: { registrationPlate: null, vin: "9bwzzz377vt-004251", brand: null, model: null } }),
    ], vehicles, noLinks)
    expect(plan.matched[0]).toMatchObject({ vehicleId: "v1", reason: "vin" })
  })

  it("un VIN que calza con dos números de serie queda ambiguo", () => {
    const plan = planWialonUnits([
      unit({ profile: { registrationPlate: null, vin: "SERIE-001", brand: null, model: null } }),
    ], vehicles, noLinks)
    expect(plan.matched).toEqual([])
    expect(plan.ambiguous).toEqual([{ unit: expect.objectContaining({ id: "unit-1" }), candidates: 2 }])
  })

  it("devuelve los vehículos duplicados para registrarlos", () => {
    const plan = planWialonUnits([
      unit({ id: "a", name: "ABCD12" }),
      unit({ id: "b", name: "ABCD-12" }),
    ], vehicles, noLinks)
    expect(plan.duplicateVehicleIds).toEqual(["v1"])
  })
})

describe("meterSourceRef", () => {
  it("trunca a la hora UTC: dos mensajes de la misma hora comparten clave", () => {
    expect(meterSourceRef("42", "hour_meter", "2026-11-12T12:03:04.000Z")).toBe("wialon:42:hour_meter:2026-11-12T12Z")
    expect(meterSourceRef("42", "hour_meter", "2026-11-12T12:59:59.999Z")).toBe("wialon:42:hour_meter:2026-11-12T12Z")
    expect(meterSourceRef("42", "hour_meter", "2026-11-12T13:00:00.000Z")).toBe("wialon:42:hour_meter:2026-11-12T13Z")
  })
})

import { describe, expect, it } from "vitest"
import type { OnwayDeviceSnapshot } from "./onway-contract"
import { reconcileOnwayDevices, type OnwayDeviceLink } from "./onway-reconciliation"

const device = (externalDeviceId: string, sourcePlate: string): OnwayDeviceSnapshot => ({
  externalDeviceId,
  groupId: "1",
  sourcePlate,
  normalizedPlate: sourcePlate.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
  latitude: -33.45,
  longitude: -70.66,
  speedKph: 0,
  headingDegrees: 0,
  ignition: false,
  sourceStatus: "active",
})

describe("reconcileOnwayDevices", () => {
  it("matches the portal device to Fleet by normalized plate", () => {
    const result = reconcileOnwayDevices(
      [device("gps-1", "AB CD 12")],
      [{ id: "vehicle-1", plate: "ABCD-12", worksiteId: "ws-1" }],
    )

    expect(result.matched).toEqual([{ device: device("gps-1", "AB CD 12"), vehicleId: "vehicle-1", worksiteId: "ws-1" }])
    expect(result.unmatched).toEqual([])
  })

  it("keeps unknown plates unmatched and never creates a vehicle", () => {
    const unknown = device("gps-2", "ZZZZ99")
    const result = reconcileOnwayDevices(
      [unknown],
      [{ id: "vehicle-1", plate: "ABCD-12", worksiteId: "ws-1" }],
    )

    expect(result.matched).toEqual([])
    expect(result.unmatched).toEqual([unknown])
  })

  it("does not guess when Fleet contains a normalized plate collision", () => {
    const ambiguous = device("gps-3", "ABCD12")
    const result = reconcileOnwayDevices(
      [ambiguous],
      [
        { id: "vehicle-1", plate: "ABCD-12", worksiteId: "ws-1" },
        { id: "vehicle-2", plate: "AB CD 12", worksiteId: "ws-2" },
      ],
    )

    expect(result.matched).toEqual([])
    expect(result.unmatched).toEqual([ambiguous])
    expect(result.ambiguousNormalizedPlates).toEqual(["ABCD12"])
  })

  describe("vínculos manuales", () => {
    const vehicles = [
      { id: "vehicle-1", plate: "ABCD-12", worksiteId: "ws-1" },
      { id: "vehicle-2", plate: "EFGH-34", worksiteId: "ws-2" },
    ]
    const links = (entries: Array<[string, OnwayDeviceLink]>) => new Map(entries)

    it("un equipo excluido queda sin vehículo, aunque su patente calce, y no cuenta como pendiente", () => {
      const excluded = device("gps-1", "ABCD12")
      const result = reconcileOnwayDevices(
        [excluded], vehicles, links([["gps-1", { status: "excluded", vehicleId: null }]]),
      )

      expect(result.matched).toEqual([])
      expect(result.unmatched).toEqual([])
      expect(result.excluded).toEqual([excluded])
    })

    it("el vínculo linked manda sobre la patente", () => {
      const moved = device("gps-1", "ABCD12")
      const result = reconcileOnwayDevices(
        [moved], vehicles, links([["gps-1", { status: "linked", vehicleId: "vehicle-2" }]]),
      )

      expect(result.matched).toEqual([{ device: moved, vehicleId: "vehicle-2", worksiteId: "ws-2" }])
      expect(result.unmatched).toEqual([])
    })

    it("el vínculo une un equipo cuya patente no existe en el catálogo", () => {
      const unknown = device("gps-1", "ZZZZ99")
      const result = reconcileOnwayDevices(
        [unknown], vehicles, links([["gps-1", { status: "linked", vehicleId: "vehicle-1" }]]),
      )

      expect(result.matched).toEqual([{ device: unknown, vehicleId: "vehicle-1", worksiteId: "ws-1" }])
    })

    it("un vínculo a un vehículo que ya no existe cae a la patente", () => {
      const stale = device("gps-1", "ABCD12")
      const result = reconcileOnwayDevices(
        [stale], vehicles, links([["gps-1", { status: "linked", vehicleId: "borrado" }]]),
      )

      expect(result.matched).toEqual([{ device: stale, vehicleId: "vehicle-1", worksiteId: "ws-1" }])
    })

    it("sin vínculo para el equipo, sigue la patente y lo desconocido queda pendiente", () => {
      const known = device("gps-1", "ABCD12")
      const unknown = device("gps-2", "ZZZZ99")
      const result = reconcileOnwayDevices(
        [known, unknown], vehicles, links([["otro", { status: "excluded", vehicleId: null }]]),
      )

      expect(result.matched.map((row) => row.device.externalDeviceId)).toEqual(["gps-1"])
      expect(result.unmatched).toEqual([unknown])
      expect(result.excluded).toEqual([])
    })
  })
})

import { describe, expect, it } from "vitest"
import type { OnwayDeviceSnapshot } from "./onway-contract"
import { reconcileOnwayDevices } from "./onway-reconciliation"

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
})

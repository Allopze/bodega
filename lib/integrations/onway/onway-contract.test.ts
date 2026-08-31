import { describe, expect, it } from "vitest"
import { parseOnwaySnapshot } from "./onway-contract"

const validDevice = {
  device_id: 41,
  group_id: 7,
  automotor_plate: "AB-CD 12",
  latitude: -33.45,
  longitude: -70.66,
  speed: 18.4,
  directionHeading: 271,
  ignition: true,
  active: "active",
  imei: "must-not-be-persisted",
  phone_number: "must-not-be-persisted",
}

describe("parseOnwaySnapshot", () => {
  it("keeps only the allowlisted GPS fields and normalizes the plate", () => {
    const result = parseOnwaySnapshot({ is_session_alive: true, devices: [validDevice] })

    expect(result).toEqual({
      devices: [{
        externalDeviceId: "41",
        groupId: "7",
        sourcePlate: "AB-CD 12",
        normalizedPlate: "ABCD12",
        latitude: -33.45,
        longitude: -70.66,
        speedKph: 18.4,
        headingDegrees: 271,
        ignition: true,
        sourceStatus: "active",
      }],
      rejected: [],
    })
    expect(JSON.stringify(result)).not.toContain("imei")
    expect(JSON.stringify(result)).not.toContain("phone_number")
  })

  it("rejects malformed devices without accepting unsafe coordinates", () => {
    const result = parseOnwaySnapshot({
      is_session_alive: true,
      devices: [
        { ...validDevice, device_id: 42, latitude: -91 },
        { ...validDevice, device_id: 43, speed: -1 },
        { ...validDevice, device_id: 44, automotor_plate: " " },
      ],
    })

    expect(result.devices).toEqual([])
    expect(result.rejected).toEqual([
      { sourceRowKey: "42", reason: "invalid_coordinates" },
      { sourceRowKey: "43", reason: "invalid_speed" },
      { sourceRowKey: "44", reason: "missing_plate" },
    ])
  })

  it("fails closed when the portal session is no longer alive", () => {
    expect(() => parseOnwaySnapshot({ is_session_alive: false, devices: [] }))
      .toThrowError("ONWAY_SESSION_EXPIRED")
  })

  it("fails closed when a device identity is duplicated", () => {
    expect(() => parseOnwaySnapshot({
      is_session_alive: true,
      devices: [validDevice, { ...validDevice, automotor_plate: "ZZ-ZZ-99" }],
    })).toThrowError("ONWAY_DUPLICATE_DEVICE")
  })

  it("caps the external payload before processing it", () => {
    expect(() => parseOnwaySnapshot({
      is_session_alive: true,
      devices: Array.from({ length: 5_001 }, (_, index) => ({ ...validDevice, device_id: index + 1 })),
    })).toThrowError("ONWAY_PAYLOAD_TOO_LARGE")
  })
})

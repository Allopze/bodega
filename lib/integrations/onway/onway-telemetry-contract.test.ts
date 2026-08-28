import { describe, expect, it } from "vitest"
import {
  parseOnwayAlertHistory,
  parseOnwayDeviceDetail,
  parseOnwayHistory,
  parseOnwayTrips,
} from "./onway-telemetry-contract"

describe("OnWay telemetry contracts", () => {
  it("allowlists detailed device telemetry without retaining personal or device identifiers", () => {
    const result = parseOnwayDeviceDetail({
      device_id: 41,
      gps_message_time: "2026-08-28T13:05:00Z",
      gprs_message_time: "2026-08-28T13:05:01Z",
      gps_status: "GPS_OK",
      gprs_status: "ONLINE",
      movement_state: "moving",
      odometer: 12345.6,
      total_ignition_time_calculate: 827.5,
      internal_battery_level: 88,
      external_power_vcc: 12.4,
      engineRpm: 1440,
      engineCoolantTemperature: 83,
      fuelLevelInput: 62.5,
      temperature_1: 19.5,
      humidity_1: 48,
      authentication_id: "driver-external-1",
      driver_name_with_key: "Chofer de prueba",
      imei: "must-not-be-returned",
      phone_number: "+56900000000",
      primaryEmergencyContact: { name: "must-not-be-returned" },
    })

    expect(result).toEqual({
      deviceId: "41",
      gpsReportedAt: "2026-08-28T13:05:00.000Z",
      gprsReportedAt: "2026-08-28T13:05:01.000Z",
      gpsStatus: "GPS_OK",
      gprsStatus: "ONLINE",
      movementState: "moving",
      odometer: 12345.6,
      hourMeter: 827.5,
      internalBatteryLevel: 88,
      externalPowerVolts: 12.4,
      engineRpm: 1440,
      coolantTemperature: 83,
      fuelLevel: 62.5,
      temperature1: 19.5,
      humidity1: 48,
      driverExternalId: "driver-external-1",
      driverDisplayName: "Chofer de prueba",
    })
    expect(JSON.stringify(result)).not.toContain("imei")
    expect(JSON.stringify(result)).not.toContain("phone")
    expect(JSON.stringify(result)).not.toContain("Emergency")
  })

  it("rejects non-finite or invalid detail telemetry instead of coercing it", () => {
    expect(parseOnwayDeviceDetail({ device_id: 1, odometer: -1 })).toBeNull()
    expect(parseOnwayDeviceDetail({ device_id: 1, external_power_vcc: "12.4" })).toEqual({
      deviceId: "1",
      gpsReportedAt: null,
      gprsReportedAt: null,
      gpsStatus: null,
      gprsStatus: null,
      movementState: null,
      odometer: null,
      hourMeter: null,
      internalBatteryLevel: null,
      externalPowerVolts: null,
      engineRpm: null,
      coolantTemperature: null,
      fuelLevel: null,
      temperature1: null,
      humidity1: null,
      driverExternalId: null,
      driverDisplayName: null,
    })
  })

  it("normalizes an alert into a stable external event without retaining its raw payload", () => {
    expect(parseOnwayAlertHistory({
      message_key: "msg-1",
      alert_id: 68,
      unit_id: 41,
      alert_description: "Exceso de velocidad",
      priority: "high",
      unit_imei: "must-not-be-returned",
      generate_time: "2026-08-28T13:10:00Z",
      latitude: -33.45,
      longitude: -70.66,
      speed: 112,
      address: "must-not-be-returned",
      camera_images: ["must-not-be-returned"],
    })).toEqual({
      externalDeviceId: "41",
      externalEventKey: "msg-1",
      alertType: "68",
      title: "Exceso de velocidad",
      priority: "high",
      occurredAt: "2026-08-28T13:10:00.000Z",
      latitude: -33.45,
      longitude: -70.66,
      speedKph: 112,
    })
  })

  it("keeps only bounded route and trip values with real timestamps", () => {
    expect(parseOnwayHistory([{ sequence: 1, generate_time: "2026-08-28T13:00:00Z", latitude: -33.45, longitude: -70.66, speed: 32, directionHeading: 90, ignition: true }]))
      .toEqual([{ sourceSequence: "1", occurredAt: "2026-08-28T13:00:00.000Z", latitude: -33.45, longitude: -70.66, speedKph: 32, headingDegrees: 90, ignition: true }])

    expect(parseOnwayTrips([{ row: 3, begin_message_time: "2026-08-28T08:00:00Z", end_message_time: "2026-08-28T09:00:00Z", distance: 24.5, no_movement_length_str: "00:10:00", movement_length_str: "00:50:00", travel_length_str: "01:00:00", begin_odometer: 100, end_odometer: 124.5 }]))
      .toEqual([{ externalTripKey: "3", startedAt: "2026-08-28T08:00:00.000Z", endedAt: "2026-08-28T09:00:00.000Z", distanceKm: 24.5, idleDuration: "00:10:00", movementDuration: "00:50:00", travelDuration: "01:00:00", beginOdometer: 100, endOdometer: 124.5 }])
  })
})

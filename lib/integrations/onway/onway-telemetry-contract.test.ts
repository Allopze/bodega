import { describe, expect, it } from "vitest"
import {
  parseOnwayAlertHistory,
  parseOnwayAlertRows,
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

  it("keeps valid device telemetry when an optional sensor is outside its range", () => {
    expect(parseOnwayDeviceDetail({
      device_id: 42,
      gps_message_time: "2026-08-28T13:05:00Z",
      odometer: 12345,
      temperature_1: 240,
    })).toMatchObject({
      deviceId: "42",
      gpsReportedAt: "2026-08-28T13:05:00.000Z",
      odometer: 12345,
      temperature1: null,
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

  it("reads the portal's localized alert title and numeric priority", () => {
    expect(parseOnwayAlertHistory({
      message_key: "msg-es-1",
      alert_id: 68,
      message: { es: "Exceso de velocidad", en: "Speeding" },
      generate_time: "2026-08-28T13:10:00Z",
      latitude: -33.45,
      longitude: -70.66,
      speed: 112,
      priority: 2,
    })).toMatchObject({
      externalEventKey: "msg-es-1",
      alertType: "68",
      title: "Exceso de velocidad",
      priority: "2",
      occurredAt: "2026-08-28T13:10:00.000Z",
    })
  })

  it("parses OnWay's .NET JSON date wrapper", () => {
    const milliseconds = Date.parse("2026-08-28T13:10:00Z")
    expect(parseOnwayAlertHistory({
      alert_id: 68,
      message: { es: "Exceso de velocidad" },
      generate_time: `/Date(${milliseconds}+0000)/`,
      latitude: -33.45,
      longitude: -70.66,
    })).toMatchObject({ occurredAt: "2026-08-28T13:10:00.000Z" })
  })

  it("maps alerts by provider IMEI and marks dropped rows as incomplete", () => {
    const result = parseOnwayAlertRows([
      {
        message_key: "msg-es-2",
        alert_id: 68,
        message: { es: "Exceso de velocidad" },
        generate_time: "2026-08-28T13:10:00Z",
        latitude: -33.45,
        longitude: -70.66,
        speed: 112,
        unit_imei: "device-imei",
        priority: 2,
      },
      { message: "fila incompleta" },
    ], [{ deviceId: "device-42", unitId: "unit-42", imei: "device-imei" }])

    expect(result.alerts).toMatchObject([{ externalDeviceId: "device-42", title: "Exceso de velocidad" }])
    expect(result.incomplete).toBe(true)
  })

  it("keeps only bounded route and trip values with real timestamps", () => {
    expect(parseOnwayHistory([{ sequence: 1, generate_time: "2026-08-28T13:00:00Z", latitude: -33.45, longitude: -70.66, speed: 32, directionHeading: 90, ignition: true }]))
      .toEqual([{ sourceSequence: "1", occurredAt: "2026-08-28T13:00:00.000Z", latitude: -33.45, longitude: -70.66, speedKph: 32, headingDegrees: 90, ignition: true }])

    expect(parseOnwayTrips([{ row: 3, begin_message_time: "2026-08-28T08:00:00Z", end_message_time: "2026-08-28T09:00:00Z", distance: 24.5, no_movement_length_str: "00:10:00", movement_length_str: "00:50:00", travel_length_str: "01:00:00", begin_odometer: 100, end_odometer: 124.5 }]))
      .toEqual([{ externalTripKey: "2026-08-28T08:00:00.000Z", startedAt: "2026-08-28T08:00:00.000Z", endedAt: "2026-08-28T09:00:00.000Z", distanceKm: 24.5, idleDuration: "00:10:00", movementDuration: "00:50:00", travelDuration: "01:00:00", beginOdometer: 100, endOdometer: 124.5 }])
  })

  // Forma real de `devices/quick/history` (2026-11-19): `sequence` es la posición
  // en la respuesta (1, 2, 3… en cada consulta) y `generate_time` viene sin zona,
  // en el `timeZone` pedido; el cliente pide "0", así que es UTC.
  it("keys a history point by its message_key and reads a zone-less time as UTC", () => {
    const point = { message_key: "8ca56f81-0fa3-43f0-8a44-1c2d3e4f5a6b", generate_time: "2026-11-18T12:05:22", latitude: -37.16, longitude: -72.06, speed: 0 }
    const first = parseOnwayHistory([{ ...point, sequence: 1 }])
    const second = parseOnwayHistory([{ ...point, sequence: 7 }])

    expect(first).toEqual([{ sourceSequence: "8ca56f81-0fa3-43f0-8a44-1c2d3e4f5a6b", occurredAt: "2026-11-18T12:05:22.000Z", latitude: -37.16, longitude: -72.06, speedKph: 0, headingDegrees: null, ignition: null }])
    // El mismo mensaje en dos ventanas solapadas debe dar la misma clave.
    expect(second[0]?.sourceSequence).toBe(first[0]?.sourceSequence)
  })

  // Forma real de `GetDeviceLatestTrips` (2026-11-19): `id` es siempre 0, `row`
  // es la posición 1..5 en la lista de últimos viajes (corre con cada viaje nuevo)
  // y `/Date(ms)/` es la hora del reloj en el desfase del usuario (`-4`) escrita
  // como si fuera UTC: el viaje que el portal muestra a las 10:47:53 trae
  // 10:47:53Z y, contra el odómetro del historial, ocurrió a las 14:47:53Z.
  it("keys a trip by when it started, not by its position in the latest-trips list", () => {
    const trip = (row: number, begin: number, end: number) => ({ id: 0, row, begin_message_time: `/Date(${begin})/`, end_message_time: `/Date(${end})/`, distance: 1.5, begin_odometer: 100, end_odometer: 101.5 })
    const earlier = parseOnwayTrips([trip(1, 1795085273200, 1795085485370)], { wallClockOffsetHours: -4 })
    const later = parseOnwayTrips([trip(1, 1795111052260, 1795111247390), trip(2, 1795085273200, 1795085485370)], { wallClockOffsetHours: -4 })

    expect(earlier[0]).toMatchObject({ externalTripKey: "2026-11-19T14:47:53.200Z", startedAt: "2026-11-19T14:47:53.200Z", endedAt: "2026-11-19T14:51:25.370Z" })
    // El viaje de antes pasó de la fila 1 a la 2 y conserva su clave; el nuevo de la fila 1 no la pisa.
    expect(later.map((t) => t.externalTripKey)).toEqual(["2026-11-19T21:57:32.260Z", "2026-11-19T14:47:53.200Z"])
  })

  // Detalle y alertas traen `/Date(ms)/` con el mismo defecto (verificado
  // 2026-11-19 a las 02:06Z: el reporte GPS más nuevo decía 22:06Z).
  it("reads detail report times in the portal user's wall clock", () => {
    const detail = parseOnwayDeviceDetail({ device_id: 41, gps_message_time: "/Date(1795125998000)/", gprs_message_time: "/Date(1795125999680)/" }, { wallClockOffsetHours: -4 })
    expect(detail).toMatchObject({ gpsReportedAt: "2026-11-20T02:06:38.000Z", gprsReportedAt: "2026-11-20T02:06:39.680Z" })
  })

  it("reads alert times in the portal user's wall clock without changing the alert's key", () => {
    const row = { alert_id: 12, alert_description: "Exceso de velocidad", generate_time: "/Date(1795124353400)/", unit_id: 41, latitude: -37.1, longitude: -72.1, speed: 95 }
    const before = parseOnwayAlertHistory(row)
    const after = parseOnwayAlertHistory(row, { wallClockOffsetHours: -4 })

    expect(after?.occurredAt).toBe("2026-11-20T01:39:13.400Z")
    // La alerta ya guardada antes del arreglo se actualiza, no se duplica.
    expect(after?.externalEventKey).toBe(before?.externalEventKey)
  })

  it("does not shift a trip time that already says its zone", () => {
    const [trip] = parseOnwayTrips([{ row: 1, begin_message_time: "2026-08-28T08:00:00Z", end_message_time: "2026-08-28T09:00:00Z", distance: 1, begin_odometer: 1, end_odometer: 2 }], { wallClockOffsetHours: -4 })
    expect(trip?.startedAt).toBe("2026-08-28T08:00:00.000Z")
  })
})

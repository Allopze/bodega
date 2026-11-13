import { describe, expect, it } from "vitest"
import { mergeLatestGpsByVehicle, type LatestGpsRow } from "../merge-latest"

function row(overrides: Partial<LatestGpsRow> = {}): LatestGpsRow {
  return {
    id: "row-1",
    provider: "onway",
    externalDeviceId: "dev-1",
    vehicleId: "veh-1",
    worksiteId: "ws-1",
    sourcePlate: "ABCD12",
    normalizedPlate: "ABCD12",
    latitude: -33.45,
    longitude: -70.65,
    speedKph: 0,
    headingDegrees: 0,
    ignition: false,
    sourceStatus: null,
    gpsReportedAt: "2026-11-12T12:00:00.000Z",
    metersReportedAt: null,
    gprsReportedAt: null,
    gpsStatus: null,
    gprsStatus: null,
    movementState: "stopped",
    odometer: null,
    hourMeter: null,
    internalBatteryLevel: null,
    externalPowerVolts: null,
    engineRpm: null,
    coolantTemperature: null,
    fuelLevel: null,
    temperature1: null,
    humidity1: null,
    driverMappingId: null,
    observedAt: "2026-11-12T12:00:05.000Z",
    ...overrides,
  }
}

describe("mergeLatestGpsByVehicle", () => {
  it("toma la posición de OnWay y el odómetro de Wialon, sin duplicar el vehículo", () => {
    const merged = mergeLatestGpsByVehicle([
      row({ id: "onway", provider: "onway", gpsReportedAt: "2026-11-12T12:00:00.000Z" }),
      row({
        id: "wialon",
        provider: "wialon",
        externalDeviceId: "unit-1",
        gpsReportedAt: "2026-11-12T11:55:00.000Z",
        odometer: 1000,
        hourMeter: 200,
      }),
    ], { now: new Date("2026-11-12T12:05:00.000Z") })

    expect(merged).toHaveLength(1)
    expect(merged[0]!).toMatchObject({
      id: "onway",
      provider: "onway",
      primaryProvider: "onway",
      providers: ["onway", "wialon"],
      odometer: 1000,
      hourMeter: 200,
      meterProvider: "wialon",
      odometerAt: "2026-11-12T11:55:00.000Z",
      hourMeterAt: "2026-11-12T11:55:00.000Z",
      gpsIsStale: false,
    })
  })

  it("prefiere la posición más fresca aunque no sea OnWay", () => {
    const merged = mergeLatestGpsByVehicle([
      row({ id: "onway", provider: "onway", gpsReportedAt: "2026-11-12T11:00:00.000Z" }),
      row({ id: "wialon", provider: "wialon", externalDeviceId: "unit-1", gpsReportedAt: "2026-11-12T11:59:00.000Z" }),
    ])
    expect(merged[0]!.id).toBe("wialon")
    expect(merged[0]!.primaryProvider).toBe("wialon")
  })

  it("desempata por OnWay cuando ambos reportan el mismo instante", () => {
    const merged = mergeLatestGpsByVehicle([
      row({ id: "wialon", provider: "wialon", externalDeviceId: "unit-1" }),
      row({ id: "onway", provider: "onway" }),
    ])
    expect(merged[0]!.id).toBe("onway")
  })

  it("conserva un 0 como lectura y no lo confunde con un dato faltante", () => {
    const merged = mergeLatestGpsByVehicle([
      row({ id: "onway", odometer: null }),
      row({ id: "wialon", provider: "wialon", externalDeviceId: "unit-1", odometer: 0 }),
    ])
    expect(merged[0]!.odometer).toBe(0)
  })

  it("no mezcla odómetro y horómetro de proveedores distintos", () => {
    const merged = mergeLatestGpsByVehicle([
      row({ id: "onway", provider: "onway", gpsReportedAt: "2026-11-12T12:00:00.000Z", odometer: 100 }),
      row({
        id: "wialon",
        provider: "wialon",
        externalDeviceId: "unit-1",
        gpsReportedAt: "2026-11-12T11:55:00.000Z",
        odometer: 900,
        hourMeter: 200,
      }),
    ])
    expect(merged[0]).toMatchObject({ meterProvider: "onway", odometer: 100, hourMeter: null })
  })

  it("elige el proveedor de medidores por la hora del mensaje, no por la de la posición", () => {
    const merged = mergeLatestGpsByVehicle([
      // OnWay tiene la posición más fresca, pero su medidor es más viejo.
      row({
        id: "onway",
        provider: "onway",
        gpsReportedAt: "2026-11-12T12:00:00.000Z",
        metersReportedAt: "2026-11-12T11:00:00.000Z",
        hourMeter: 100,
      }),
      // Wialon tiene la posición vieja (sin señal GPS) pero un mensaje posterior.
      row({
        id: "wialon",
        provider: "wialon",
        externalDeviceId: "unit-1",
        gpsReportedAt: "2026-11-12T10:00:00.000Z",
        metersReportedAt: "2026-11-12T11:58:00.000Z",
        hourMeter: 105,
      }),
    ])
    expect(merged[0]).toMatchObject({
      primaryProvider: "onway",
      meterProvider: "wialon",
      hourMeter: 105,
      hourMeterAt: "2026-11-12T11:58:00.000Z",
    })
  })

  it("la hora de odómetro, horómetro y nivel sale del mensaje; sin ella, de la posición", () => {
    const merged = mergeLatestGpsByVehicle([
      row({
        provider: "wialon",
        gpsReportedAt: "2026-11-12T10:00:00.000Z",
        metersReportedAt: "2026-11-12T11:58:00.000Z",
        odometer: 10,
        hourMeter: 5,
        fuelLevel: 40,
      }),
    ])
    expect(merged[0]).toMatchObject({
      odometerAt: "2026-11-12T11:58:00.000Z",
      hourMeterAt: "2026-11-12T11:58:00.000Z",
      fuelLevelAt: "2026-11-12T11:58:00.000Z",
    })
    const legacy = mergeLatestGpsByVehicle([row({ odometer: 10 })])
    expect(legacy[0]!.odometerAt).toBe("2026-11-12T12:00:00.000Z")
  })

  it("conserva el encendido conocido aunque la última posición no lo informe", () => {
    const merged = mergeLatestGpsByVehicle([
      row({
        id: "wialon",
        provider: "wialon",
        externalDeviceId: "unit-1",
        gpsReportedAt: "2026-11-12T12:00:00.000Z",
        ignition: false,
        sourceStatus: "ignition_unknown",
      }),
      row({ id: "onway", provider: "onway", gpsReportedAt: "2026-11-12T11:55:00.000Z", ignition: true }),
    ])
    expect(merged[0]).toMatchObject({ ignition: true, ignitionKnown: true })
  })

  it("marca atrasada una posición de más de 15 minutos", () => {
    const merged = mergeLatestGpsByVehicle(
      [row({ gpsReportedAt: "2026-11-12T12:00:00.000Z" })],
      { now: new Date("2026-11-12T12:16:00.000Z") },
    )
    expect(merged[0]!.gpsIsStale).toBe(true)
  })

  it("ignora las filas sin vehículo: son unidades pendientes, no activos", () => {
    const merged = mergeLatestGpsByVehicle([row({ vehicleId: null })])
    expect(merged).toEqual([])
  })
})

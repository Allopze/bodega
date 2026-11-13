import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import type { OnwayTelemetryBundle } from "./onway-client"
import type { OnwayDeviceTelemetry } from "./onway-telemetry-contract"

/**
 * 2026-11-02 → 11-08: el portal aceptaba la sesión pero devolvía `devices: []`
 * y cada corrida del cron quedaba `success` con 0 equipos. Las posiciones
 * siguieron congeladas en el 30-10 sin que ninguna señal lo marcara. Un
 * snapshot vacío tiene que verse como falla en la bitácora.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  fetchOnwayTelemetry: vi.fn(),
  applyOnwayAlertRules: vi.fn(async () => undefined),
}))

vi.mock("@/lib/integrations/onway/onway-settings", () => ({
  readOnwayConfig: async () => ({ username: "cuenta", password: "clave", syncEnabled: true, hasCredentials: true }),
}))
vi.mock("@/lib/integrations/onway/onway-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("./onway-client")>(),
  fetchOnwayTelemetry: (...args: unknown[]) => Reflect.apply(mocks.fetchOnwayTelemetry, null, args),
}))
vi.mock("@/lib/integrations/onway/onway-automation", () => ({
  applyOnwayAlertRules: () => mocks.applyOnwayAlertRules(),
}))

const { syncOnway } = await import("./onway-sync")
const { OnwayClientError } = await import("./onway-client")

function telemetry(snapshot: OnwayTelemetryBundle["snapshot"]): OnwayTelemetryBundle {
  return {
    snapshot,
    details: [],
    alerts: [],
    historyByDeviceId: new Map(),
    tripsByDeviceId: new Map(),
    warnings: [],
  }
}

const FROZEN_AT = "2026-10-30T15:36:22.000Z"

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  // La última lectura buena: la que no debe moverse cuando el portal viene vacío.
  await testDb.insert(schema.fleetGpsSyncRuns).values({
    id: "gpsrun-ultimo-con-datos",
    trigger: "cron",
    status: "success",
    devicesReceived: 1,
    startedAt: FROZEN_AT,
    finishedAt: FROZEN_AT,
  })
  await testDb.insert(schema.fleetGpsLatestPositions).values({
    id: "gpspos-congelada",
    externalDeviceId: "9001",
    externalGroupId: "10",
    sourcePlate: "AB-CD-12",
    normalizedPlate: "ABCD12",
    latitude: -36.8,
    longitude: -73.05,
    speedKph: 0,
    headingDegrees: 0,
    ignition: false,
    observedAt: FROZEN_AT,
    syncRunId: "gpsrun-ultimo-con-datos",
  })
})

beforeEach(() => {
  mocks.fetchOnwayTelemetry.mockReset()
})

describe("syncOnway con un snapshot vacío", () => {
  it("falla con ONWAY_SNAPSHOT_EMPTY y lo deja en la bitácora en vez de marcar success", async () => {
    mocks.fetchOnwayTelemetry.mockResolvedValue(telemetry({ devices: [], rejected: [] }))

    const error = await syncOnway({ trigger: "cron", includeHistory: false }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OnwayClientError)
    expect((error as InstanceType<typeof OnwayClientError>).code).toBe("ONWAY_SNAPSHOT_EMPTY")

    const run = await testDb.select().from(schema.fleetGpsSyncRuns)
      .where(eq(schema.fleetGpsSyncRuns.trigger, "cron"))
      .orderBy(schema.fleetGpsSyncRuns.startedAt)
      .then((rows) => rows.at(-1))
    expect(run).toMatchObject({ status: "failed", errorCode: "ONWAY_SNAPSHOT_EMPTY", devicesReceived: 0 })
    expect(run?.finishedAt).toBeTruthy()
    expect(mocks.applyOnwayAlertRules).not.toHaveBeenCalled()
  })

  it("no toca la última posición conocida", async () => {
    mocks.fetchOnwayTelemetry.mockResolvedValue(telemetry({ devices: [], rejected: [] }))

    await syncOnway({ trigger: "cron", includeHistory: false }).catch(() => undefined)

    const [position] = await testDb.select().from(schema.fleetGpsLatestPositions)
      .where(eq(schema.fleetGpsLatestPositions.id, "gpspos-congelada"))
    expect(position?.syncRunId).toBe("gpsrun-ultimo-con-datos")
    expect(new Date(position?.observedAt ?? 0).toISOString()).toBe(FROZEN_AT)
  })

  it("un snapshot con filas, aunque todas rechazadas, no es vacío: sigue siendo parcial", async () => {
    mocks.fetchOnwayTelemetry.mockResolvedValue(telemetry({
      devices: [],
      rejected: [{ sourceRowKey: "row:1", reason: "missing_plate" }],
    }))

    const result = await syncOnway({ trigger: "cron", includeHistory: false })

    expect(result.received).toBe(1)
    const [run] = await testDb.select().from(schema.fleetGpsSyncRuns)
      .where(eq(schema.fleetGpsSyncRuns.id, result.runId))
    expect(run).toMatchObject({ status: "partial", errorCode: null })
  })
})

/**
 * Refresco por minuto de Monitoreo GPS: sólo el snapshot del mapa. La hora GPS,
 * la señal y los medidores vienen del detalle (cada 5 min, en el cron): una
 * lectura liviana no puede dejarlos en blanco.
 */
describe("syncOnway sólo con posiciones (refresco en vivo)", () => {
  const DETAIL_AT = "2026-11-09T12:00:00.000Z"

  beforeAll(async () => {
    await testDb.insert(schema.fleetGpsSyncRuns).values({
      id: "gpsrun-con-detalle", trigger: "cron", status: "success", devicesReceived: 1,
      startedAt: DETAIL_AT, finishedAt: DETAIL_AT,
    })
    await testDb.insert(schema.fleetGpsLatestPositions).values({
      id: "gpspos-con-detalle", externalDeviceId: "9002", externalGroupId: "10",
      sourcePlate: "EF-GH-34", normalizedPlate: "EFGH34",
      latitude: -36.8, longitude: -73.05, speedKph: 0, headingDegrees: 0, ignition: false,
      gpsReportedAt: DETAIL_AT, metersReportedAt: DETAIL_AT, gpsStatus: "A", odometer: 220784, movementState: "stopped",
      observedAt: DETAIL_AT, syncRunId: "gpsrun-con-detalle",
    })
  })

  it("mueve la posición y la hora de captura, y conserva lo que vino del detalle", async () => {
    mocks.fetchOnwayTelemetry.mockResolvedValue(telemetry({
      devices: [{
        externalDeviceId: "9002", groupId: "10", sourcePlate: "EF-GH-34", normalizedPlate: "EFGH34",
        latitude: -37.1, longitude: -72.9, speedKph: 54, headingDegrees: 90, ignition: true, sourceStatus: "1",
      }],
      rejected: [],
    }))
    const now = new Date("2026-11-09T12:03:00.000Z")
    mocks.applyOnwayAlertRules.mockClear()

    const result = await syncOnway({ trigger: "live", positionsOnly: true, now })

    expect(mocks.fetchOnwayTelemetry).toHaveBeenCalledWith(
      expect.anything(),
      { includeDetails: false, includeHistory: false },
    )
    const [position] = await testDb.select().from(schema.fleetGpsLatestPositions)
      .where(eq(schema.fleetGpsLatestPositions.id, "gpspos-con-detalle"))
    expect(position).toMatchObject({
      latitude: -37.1, longitude: -72.9, speedKph: 54, headingDegrees: 90, ignition: true,
      syncRunId: result.runId, gpsStatus: "A", odometer: 220784, movementState: "stopped",
    })
    expect(new Date(position?.observedAt ?? 0).toISOString()).toBe(now.toISOString())
    expect(new Date(position?.gpsReportedAt ?? 0).toISOString()).toBe(DETAIL_AT)
    expect(new Date(position?.metersReportedAt ?? 0).toISOString()).toBe(DETAIL_AT)

    const [run] = await testDb.select().from(schema.fleetGpsSyncRuns)
      .where(eq(schema.fleetGpsSyncRuns.id, result.runId))
    expect(run).toMatchObject({ trigger: "live", devicesReceived: 1 })
    expect(mocks.applyOnwayAlertRules).not.toHaveBeenCalled()
  })
})

/**
 * Lecturas de medidor y vínculos manuales. Las patentes del catálogo llevan
 * guion (`CB-JY-18`) y el resolver comparaba la patente normalizada contra la
 * cruda, así que ninguna lectura `gps_onway` llegó nunca a guardarse.
 */
describe("syncOnway: medidores GPS y vínculos manuales", () => {
  const WS = "ws-medidores"
  const EQ = "eq-medidores"
  const V_MAIN = "veh-medidores-principal"
  const V_LINKED = "veh-medidores-vinculado"
  const V_EXCLUDED = "veh-medidores-excluido"

  const device = (id: string, plate: string) => ({
    externalDeviceId: id, groupId: "10", sourcePlate: plate,
    normalizedPlate: plate.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
    latitude: -36.8, longitude: -73.05, speedKph: 0, headingDegrees: 0, ignition: false, sourceStatus: "1",
  })
  const detail = (deviceId: string, gpsReportedAt: string, odometer: number): OnwayDeviceTelemetry => ({
    deviceId, gpsReportedAt, gprsReportedAt: gpsReportedAt, gpsStatus: "A", gprsStatus: "A", movementState: "stopped",
    odometer, hourMeter: null, internalBatteryLevel: null, externalPowerVolts: null, engineRpm: null,
    coolantTemperature: null, fuelLevel: null, temperature1: null, humidity1: null,
    driverExternalId: null, driverDisplayName: null,
  })
  const readings = (ref?: string) => testDb.select().from(schema.fuelMeterReadings)
    .where(and(
      eq(schema.fuelMeterReadings.source, "gps_onway"),
      eq(schema.fuelMeterReadings.vehicleId, V_MAIN),
      ref ? eq(schema.fuelMeterReadings.sourceRef, ref) : undefined,
    ))

  beforeAll(async () => {
    await testDb.insert(schema.worksites).values({ id: WS, name: "Faena medidores", code: "FMED", isActive: true })
    await testDb.insert(schema.fuelEquipmentTypes).values({ id: EQ, slug: "camion-medidores", name: "Camión medidores" })
    await testDb.insert(schema.fuelVehicles).values([
      { id: V_MAIN, plate: "CB-JY-18", type: "camion", equipmentTypeId: EQ, worksiteId: WS, meterType: "odometer", isActive: true },
      { id: V_LINKED, plate: "MM-NN-66", type: "camion", equipmentTypeId: EQ, worksiteId: WS, meterType: "odometer", isActive: true },
      { id: V_EXCLUDED, plate: "KK-LL-55", type: "camion", equipmentTypeId: EQ, worksiteId: WS, meterType: "odometer", isActive: true },
    ])
    await testDb.insert(schema.fleetGpsDeviceLinks).values([
      { id: "link-vinculado", provider: "onway", externalDeviceId: "9102", status: "linked", vehicleId: V_LINKED },
      { id: "link-excluido", provider: "onway", externalDeviceId: "9101", status: "excluded", reason: "Equipo de un tercero" },
    ])
  })

  it("guarda la lectura gps_onway aunque la patente del catálogo lleve guion", async () => {
    mocks.fetchOnwayTelemetry.mockResolvedValue({
      ...telemetry({ devices: [device("9100", "CBJY-18")], rejected: [] }),
      details: [detail("9100", "2026-11-10T14:05:00.000Z", 1000)],
    })
    const now = new Date("2026-11-10T14:06:00.000Z")

    const result = await syncOnway({ trigger: "cron", includeHistory: false, now })

    const rows = await readings()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      plate: "CB-JY-18", source: "gps_onway", meterType: "odometer", value: 1000,
      sourceRef: "onway:9100:odometer:2026-11-10T14Z",
    })
    const [position] = await testDb.select().from(schema.fleetGpsLatestPositions)
      .where(eq(schema.fleetGpsLatestPositions.externalDeviceId, "9100"))
    expect(position?.vehicleId).toBe(V_MAIN)
    expect(new Date(position?.metersReportedAt ?? 0).toISOString()).toBe("2026-11-10T14:05:00.000Z")

    // `finishedAt` es la hora de cierre, no la de inicio (`now`).
    const [run] = await testDb.select().from(schema.fleetGpsSyncRuns).where(eq(schema.fleetGpsSyncRuns.id, result.runId))
    expect(run?.finishedAt).toBeTruthy()
    expect(new Date(run!.finishedAt!).getTime()).toBeGreaterThan(now.getTime())
  })

  it("deja una sola lectura por equipo y hora (la última) y otra al cambiar la hora", async () => {
    const sync = async (at: string, odometer: number) => {
      mocks.fetchOnwayTelemetry.mockResolvedValue({
        ...telemetry({ devices: [device("9100", "CBJY-18")], rejected: [] }),
        details: [detail("9100", at, odometer)],
      })
      await syncOnway({ trigger: "cron", includeHistory: false, now: new Date(at) })
    }

    await sync("2026-11-10T14:40:00.000Z", 1010)
    const sameHour = await readings("onway:9100:odometer:2026-11-10T14Z")
    expect(sameHour).toHaveLength(1)
    expect(sameHour[0]?.value).toBe(1010)
    expect(new Date(sameHour[0]!.occurredAt).toISOString()).toBe("2026-11-10T14:40:00.000Z")

    await sync("2026-11-10T15:02:00.000Z", 1030)
    expect(await readings()).toHaveLength(2)
    expect((await readings("onway:9100:odometer:2026-11-10T15Z"))[0]?.value).toBe(1030)
  })

  it("el vínculo manual manda sobre la patente y el excluido no cuenta como pendiente", async () => {
    mocks.fetchOnwayTelemetry.mockResolvedValue(telemetry({
      devices: [
        // Patente distinta de la del catálogo: sólo el vínculo lo une a V_LINKED.
        device("9102", "ZZ-TOP-11"),
        // Patente que SÍ calza con V_EXCLUDED: la exclusión gana.
        device("9101", "KK-LL-55"),
      ],
      rejected: [],
    }))

    const result = await syncOnway({ trigger: "cron", includeHistory: false })

    expect(result).toMatchObject({ received: 2, matched: 1, unmatched: 0, unmatchedPlates: [] })
    const positions = await testDb.select().from(schema.fleetGpsLatestPositions)
    expect(positions.find((row) => row.externalDeviceId === "9102")?.vehicleId).toBe(V_LINKED)
    expect(positions.find((row) => row.externalDeviceId === "9101")?.vehicleId).toBeNull()
    const [run] = await testDb.select().from(schema.fleetGpsSyncRuns).where(eq(schema.fleetGpsSyncRuns.id, result.runId))
    expect(run).toMatchObject({ status: "success", devicesAccepted: 1, devicesUnmatched: 0 })
  })
})

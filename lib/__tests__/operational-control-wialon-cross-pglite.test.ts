import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Cruce de proveedores GPS en el panel: un vehículo con OnWay y Wialon debe
 * aparecer una sola vez, con la posición más fresca y el medidor de la lectura
 * más reciente. La unidad Wialon sin vehículo no entra al panel.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getOperationalControlHub } = await import("@/lib/services/operational-control")
const { getFleetGpsMonitoring } = await import("@/lib/services/fleet-gps")

function session(permissions: string[]): Session {
  return {
    user: { id: IDS.user, isGlobal: true, roles: [], worksiteIds: [], permissions },
    expires: "2099-01-01",
  } as unknown as Session
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)

  await testDb.insert(schema.fleetGpsSyncRuns).values([
    { id: "run-onway", provider: "onway", trigger: "cron", status: "success", startedAt: "2026-03-10T12:01:00.000Z", finishedAt: "2026-03-10T12:01:00.000Z" },
    { id: "run-wialon", provider: "wialon", trigger: "cron", status: "success", startedAt: "2026-03-10T11:56:00.000Z", finishedAt: "2026-03-10T11:56:00.000Z" },
  ])

  await testDb.insert(schema.fleetGpsLatestPositions).values([
    {
      id: "gps-onway-a",
      provider: "onway",
      externalDeviceId: "onway-dev-a",
      externalGroupId: "onway-group",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      sourcePlate: "AA-0001",
      normalizedPlate: "AA0001",
      latitude: -33.45,
      longitude: -70.65,
      speedKph: 10,
      headingDegrees: 90,
      ignition: true,
      gpsReportedAt: "2026-03-10T12:00:00.000Z",
      observedAt: "2026-03-10T12:01:00.000Z",
      syncRunId: "run-onway",
    },
    {
      id: "gps-wialon-a",
      provider: "wialon",
      externalDeviceId: "wialon-unit-a",
      externalGroupId: "10",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      sourcePlate: "KA-1",
      normalizedPlate: "KA1",
      latitude: -33.44,
      longitude: -70.64,
      speedKph: 0,
      headingDegrees: 0,
      ignition: false,
      gpsReportedAt: "2026-03-10T11:55:00.000Z",
      observedAt: "2026-03-10T11:56:00.000Z",
      hourMeter: 500,
      odometer: 1200,
      syncRunId: "run-wialon",
    },
    {
      id: "gps-wialon-unmatched",
      provider: "wialon",
      externalDeviceId: "wialon-unit-unmatched",
      externalGroupId: "10",
      vehicleId: null,
      worksiteId: null,
      sourcePlate: "EXCAVADORA 01",
      normalizedPlate: "EXCAVADORA01",
      latitude: -33.4,
      longitude: -70.6,
      speedKph: 0,
      headingDegrees: 0,
      ignition: false,
      gpsReportedAt: "2026-03-10T11:55:00.000Z",
      observedAt: "2026-03-10T11:56:00.000Z",
      syncRunId: "run-wialon",
    },
  ])
})

describe("cruce de proveedores GPS en Control Operacional", () => {
  it("colapsa OnWay + Wialon en una fila y no suma medidores de fuentes distintas", async () => {
    const data = await getOperationalControlHub(session(["flota:view", "combustibles:view", "mant:records:view_all"]), MARCH)
    const asset = data.assets.find((item) => item.id === IDS.vA)
    expect(asset).toMatchObject({
      gpsProvider: "onway",
      gpsProviders: ["onway", "wialon"],
      gpsHourMeter: 500,
      gpsSpeedKph: 10,
      gpsIgnition: true,
    })
    expect(Date.parse(asset?.gpsHourMeterAt ?? "")).toBe(Date.parse("2026-03-10T11:55:00.000Z"))
    expect(data.assets.filter((item) => item.id === IDS.vA)).toHaveLength(1)
    expect(data.gpsCross).toMatchObject({
      totalVehicles: 3,
      byProvider: { onway: 0, wialon: 0, both: 1 },
      meterMismatches: 0,
      maintenance: { overdue: 0, upcoming: 0, estimated: 0 },
    })
    expect(data.gpsCross.fuelPerformance.calculated).toBe(0)
    expect(data.gpsCross.fuelPerformance.insufficient).toBe(3)
  })

  it("Monitoreo GPS también entrega una sola posición por vehículo y cuenta la unidad sin vincular", async () => {
    const monitoring = await getFleetGpsMonitoring(session(["flota:view", "flota:manage_gps"]))
    expect(monitoring.positions).toHaveLength(1)
    expect(monitoring.positions[0]).toMatchObject({
      vehicleId: IDS.vA,
      providers: ["onway", "wialon"],
      primaryProvider: "onway",
      hourMeter: 500,
    })
    expect(monitoring.unmatchedByProvider.wialon).toBe(1)
    expect(monitoring.providerRuns.onway?.id).toBe("run-onway")
    expect(monitoring.providerRuns.wialon?.id).toBe("run-wialon")
  })
})

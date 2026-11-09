import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import type { OnwayTelemetryBundle } from "./onway-client"

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

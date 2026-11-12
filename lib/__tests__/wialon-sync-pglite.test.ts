import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Sync Wialon contra PGlite: upsert idempotente de posiciones, lectura de
 * medidor con su fuente propia y unidades sin vincular que no crean vehículos.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { syncWialon } = await import("@/lib/integrations/wialon/wialon-sync")
const { hasStalledOnwayCronRun } = await import("@/lib/integrations/onway/onway-sync")

const SECONDS = 1_760_000_000

function wialonFetch(units: unknown[]): typeof fetch {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ""))
    const svc = body.get("svc")
    const payload = svc === "token/login" ? { sid: "sid-test" } : { items: units }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
}

const units = [
  {
    id: 101,
    nm: "KA-1",
    pos: { x: -70.65, y: -33.45, s: 0, c: 0, sc: 8, t: SECONDS },
    lmsg: { t: SECONDS, p: { engine_hours: 500, mileage: 1200, ignition: 1 } },
  },
  {
    id: 102,
    nm: "EXCAVADORA 01",
    pos: { x: -70.64, y: -33.44, s: 0, c: 0, sc: 6, t: SECONDS },
    lmsg: { t: SECONDS, p: { engine_hours: 30, ignition: 0 } },
  },
  {
    id: 103,
    nm: "CC-0003",
    lmsg: { t: SECONDS, p: { engine_hours: 12 } },
  },
]

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  process.env.WIALON_BASE_URL = "https://hst-api.wialon.com"
  process.env.WIALON_TOKEN = "token-test"
  process.env.WIALON_SYNC_ENABLED = "true"
})

afterAll(() => {
  delete process.env.WIALON_BASE_URL
  delete process.env.WIALON_TOKEN
  delete process.env.WIALON_SYNC_ENABLED
})

describe("syncWialon", () => {
  it("hace upsert de posiciones y guarda una lectura de medidor por equipo", async () => {
    const result = await syncWialon({ trigger: "manual", now: new Date("2026-11-12T12:00:00.000Z"), fetchImpl: wialonFetch(units) })

    expect(result).toMatchObject({
      unitsReceived: 3,
      matched: 2,
      unmatched: 1,
      ambiguous: 0,
      positionsUpserted: 2,
      metersSaved: 1,
      skippedNoPosition: 1,
    })

    const positions = await testDb.select().from(schema.fleetGpsLatestPositions)
      .where(eq(schema.fleetGpsLatestPositions.provider, "wialon"))
    expect(positions).toHaveLength(2)
    expect(positions.find((row) => row.externalDeviceId === "101")).toMatchObject({
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      hourMeter: 500,
      odometer: 1200,
    })
    expect(positions.find((row) => row.externalDeviceId === "102")).toMatchObject({
      vehicleId: null,
      worksiteId: null,
    })

    const readings = await testDb.select().from(schema.fuelMeterReadings)
      .where(eq(schema.fuelMeterReadings.source, "gps_wialon"))
    expect(readings).toHaveLength(1)
    expect(readings[0]).toMatchObject({ vehicleId: IDS.vA, meterType: "hour_meter", value: 500 })

    const [run] = await testDb.select().from(schema.fleetGpsSyncRuns)
      .where(and(
        eq(schema.fleetGpsSyncRuns.provider, "wialon"),
        eq(schema.fleetGpsSyncRuns.id, result.runId),
      ))
    expect(run).toMatchObject({ status: "success", devicesAccepted: 2, devicesUnmatched: 1, devicesRejected: 1 })
  })

  it("repetir la corrida no duplica posiciones ni lecturas", async () => {
    const beforePositions = await testDb.$count(schema.fleetGpsLatestPositions)
    const beforeReadings = await testDb.$count(schema.fuelMeterReadings)
    await syncWialon({ trigger: "cron", now: new Date("2026-11-12T12:05:00.000Z"), fetchImpl: wialonFetch(units) })
    expect(await testDb.$count(schema.fleetGpsLatestPositions)).toBe(beforePositions)
    expect(await testDb.$count(schema.fuelMeterReadings)).toBe(beforeReadings)
  })

  it("elimina la última posición de una unidad que desaparece del inventario", async () => {
    const result = await syncWialon({
      trigger: "cron",
      now: new Date("2026-11-12T12:10:00.000Z"),
      fetchImpl: wialonFetch([units[0]]),
    })
    expect(result.removedUnits).toBe(1)

    const positions = await testDb.select().from(schema.fleetGpsLatestPositions)
      .where(eq(schema.fleetGpsLatestPositions.provider, "wialon"))
    expect(positions.map((row) => row.externalDeviceId)).toEqual(["101"])
  })

  it("no pisa el encendido conocido con un mensaje que no lo informa", async () => {
    await syncWialon({
      trigger: "cron",
      now: new Date("2026-11-12T12:15:00.000Z"),
      fetchImpl: wialonFetch([{
        ...units[0],
        lmsg: { t: SECONDS + 300, p: { engine_hours: 501, mileage: 1201 } },
      }]),
    })

    const [position] = await testDb.select().from(schema.fleetGpsLatestPositions)
      .where(eq(schema.fleetGpsLatestPositions.externalDeviceId, "101"))
    expect(position?.ignition).toBe(true)
  })

  it("una corrida Wialon no se confunde con una de OnWay al buscar una corrida colgada", async () => {
    // La corrida Wialon del test anterior sigue `running` si el proceso se cortara;
    // el chequeo de OnWay debe mirar sólo su proveedor.
    await testDb.insert(schema.fleetGpsSyncRuns).values({
      id: "onway-cron-ok",
      provider: "onway",
      trigger: "cron",
      status: "success",
      startedAt: "2026-11-12T11:55:00.000Z",
      finishedAt: "2026-11-12T11:56:00.000Z",
    })
    await expect(hasStalledOnwayCronRun(new Date("2026-11-12T13:00:00.000Z"))).resolves.toBe(false)
  })
})

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  config: { username: "cuenta", password: "clave", syncEnabled: true, hasCredentials: true },
  syncOnway: vi.fn(),
  lockBusy: false,
}))

vi.mock("@/lib/integrations/onway/onway-settings", () => ({ readOnwayConfig: async () => mocks.config }))
vi.mock("@/lib/integrations/onway/onway-sync", () => ({
  syncOnway: (...args: unknown[]) => Reflect.apply(mocks.syncOnway, null, args),
}))
vi.mock("@/lib/services/cron-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/cron-lock")>()
  return {
    ...actual,
    // En PGlite hay una sola sesión y el advisory lock es reentrante: el lock
    // ocupado por el cron se simula; el camino libre usa el lock real.
    withCronLock: (...args: Parameters<typeof actual.withCronLock>) =>
      mocks.lockBusy ? Promise.resolve({ skipped: true, reason: "another run in progress" }) : actual.withCronLock(...args),
  }
})

const { refreshOnwayLive, isNearOnwayCronSlot } = await import("./onway-live")
const { OnwayClientError } = await import("./onway-client")

// 12:02:30 UTC: lejos de la próxima corrida del cron (12:05:00).
const NOW = new Date("2026-11-09T12:02:30.000Z")

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
})

beforeEach(async () => {
  await testDb.delete(schema.fleetGpsLatestPositions)
  await testDb.delete(schema.fleetGpsSyncRuns)
  await testDb.delete(schema.cronRuns)
  mocks.config = { username: "cuenta", password: "clave", syncEnabled: true, hasCredentials: true }
  mocks.lockBusy = false
  mocks.syncOnway.mockReset()
  mocks.syncOnway.mockResolvedValue({ observedAt: NOW.toISOString() })
})

async function seedRun(startedAt: string, trigger: "cron" | "live" = "cron", provider: "onway" | "wialon" = "onway") {
  await testDb.insert(schema.fleetGpsSyncRuns).values({ id: `gpsrun-${provider}-${startedAt}`, provider, trigger, status: "success", startedAt, finishedAt: startedAt })
}

describe("refreshOnwayLive", () => {
  it("lee sólo posiciones, como corrida `live` del usuario, sin escribir en la bitácora del cron", async () => {
    await seedRun("2026-11-09T12:00:00.000Z")

    const result = await refreshOnwayLive({ actorUserId: "user-1", now: NOW })

    expect(result).toEqual({ outcome: "synced", observedAt: NOW.toISOString() })
    expect(mocks.syncOnway).toHaveBeenCalledWith({ trigger: "live", positionsOnly: true, actorUserId: "user-1", now: NOW })
    expect(await testDb.select().from(schema.cronRuns)).toEqual([])
  })

  it("no vuelve a consultar el portal si una corrida de OnWay empezó hace menos de 50 s", async () => {
    await seedRun("2026-11-09T12:01:50.000Z", "live")

    expect(await refreshOnwayLive({ now: NOW })).toEqual({ outcome: "skipped", reason: "recent" })
    expect(mocks.syncOnway).not.toHaveBeenCalled()
  })

  it("devuelve la marca de captura de OnWay para que cada página sepa si ya tiene esos datos", async () => {
    await seedRun("2026-11-09T12:01:50.000Z", "live")
    await testDb.insert(schema.fleetGpsSyncRuns).values({ id: "run-pos", provider: "onway", trigger: "live", status: "success" })
    await testDb.insert(schema.fleetGpsLatestPositions).values({
      id: "pos-onway", provider: "onway", externalDeviceId: "dev-1", externalGroupId: "0",
      sourcePlate: "X", normalizedPlate: "X", latitude: -33.4, longitude: -70.6, speedKph: 0, headingDegrees: 0,
      ignition: false, observedAt: "2026-11-09T12:01:50.000Z", syncRunId: "run-pos",
    })

    expect(await refreshOnwayLive({ now: NOW })).toEqual({
      outcome: "skipped",
      reason: "recent",
      observedAt: "2026-11-09T12:01:50.000Z",
    })
  })

  it("una corrida reciente de Wialon no frena la lectura de OnWay", async () => {
    // El cron y las lecturas en vivo de Wialon dejan corridas propias: miradas
    // como «cualquier proveedor», OnWay quedaba sin leer.
    await seedRun("2026-11-09T12:02:25.000Z", "cron", "wialon")

    expect((await refreshOnwayLive({ now: NOW })).outcome).toBe("synced")
    expect(mocks.syncOnway).toHaveBeenCalledTimes(1)
  })

  it("no se adelanta al cron de cada 5 minutos, que es el que trae el detalle", async () => {
    const justBeforeCron = new Date("2026-11-09T12:04:50.000Z")

    expect(await refreshOnwayLive({ now: justBeforeCron })).toEqual({ outcome: "skipped", reason: "cron_window" })
    expect(mocks.syncOnway).not.toHaveBeenCalled()
  })

  it("si el cron tiene el lock, se salta en vez de navegar el portal al mismo tiempo", async () => {
    mocks.lockBusy = true

    expect(await refreshOnwayLive({ now: NOW })).toEqual({ outcome: "skipped", reason: "busy" })
    expect(mocks.syncOnway).not.toHaveBeenCalled()
  })

  it("sin credenciales o con la sincronización apagada no consulta nada", async () => {
    mocks.config = { username: "", password: "", syncEnabled: true, hasCredentials: false }
    expect(await refreshOnwayLive({ now: NOW })).toEqual({ outcome: "disabled", reason: "credentials" })

    mocks.config = { username: "cuenta", password: "clave", syncEnabled: false, hasCredentials: true }
    expect(await refreshOnwayLive({ now: NOW })).toEqual({ outcome: "disabled", reason: "sync_disabled" })
    expect(mocks.syncOnway).not.toHaveBeenCalled()
  })

  it("una falla del portal vuelve con su código, sin lanzar", async () => {
    mocks.syncOnway.mockRejectedValue(new OnwayClientError("ONWAY_PORTAL_TIMEOUT"))

    expect(await refreshOnwayLive({ now: NOW })).toEqual({ outcome: "failed", code: "ONWAY_PORTAL_TIMEOUT" })
  })
})

describe("isNearOnwayCronSlot", () => {
  it("marca sólo los 15 s previos a cada múltiplo de 5 minutos", () => {
    expect(isNearOnwayCronSlot(new Date("2026-11-09T12:04:44.000Z"))).toBe(false)
    expect(isNearOnwayCronSlot(new Date("2026-11-09T12:04:45.000Z"))).toBe(true)
    expect(isNearOnwayCronSlot(new Date("2026-11-09T12:04:59.999Z"))).toBe(true)
    expect(isNearOnwayCronSlot(new Date("2026-11-09T12:05:00.000Z"))).toBe(false)
  })
})

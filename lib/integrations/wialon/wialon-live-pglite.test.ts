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
  config: { hasCredentials: true, syncEnabled: true },
  refreshWialonPositions: vi.fn(),
  lockBusy: false,
}))

vi.mock("./wialon-settings", () => ({ loadWialonConfig: async () => mocks.config }))
vi.mock("./wialon-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./wialon-sync")>()
  return { ...actual, refreshWialonPositions: (...args: unknown[]) => Reflect.apply(mocks.refreshWialonPositions, null, args) }
})
vi.mock("@/lib/services/cron-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/cron-lock")>()
  return {
    ...actual,
    withCronLock: (...args: Parameters<typeof actual.withCronLock>) =>
      mocks.lockBusy ? Promise.resolve({ skipped: true, reason: "another run in progress" }) : actual.withCronLock(...args),
  }
})

const { refreshWialonLive, isNearWialonCronSlot, resetWialonLiveThrottle } = await import("./wialon-live")
const { WialonClientError } = await import("./wialon-client")

// 12:04:30 UTC: lejos del turno del cron de Wialon (minutos 2, 7, 12…).
const NOW = new Date("2026-11-09T12:04:30.000Z")

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.fleetGpsSyncRuns).values({ id: "run-1", provider: "wialon", trigger: "cron", status: "success" })
})

async function seedPosition(provider: "onway" | "wialon", observedAt: string) {
  await testDb.delete(schema.fleetGpsLatestPositions)
  await testDb.insert(schema.fleetGpsLatestPositions).values({
    id: `pos-${provider}`,
    provider,
    externalDeviceId: "dev-1",
    externalGroupId: "0",
    sourcePlate: "X",
    normalizedPlate: "X",
    latitude: -33.4,
    longitude: -70.6,
    speedKph: 0,
    headingDegrees: 0,
    ignition: false,
    observedAt,
    syncRunId: "run-1",
  })
}

beforeEach(async () => {
  await testDb.delete(schema.fleetGpsLatestPositions)
  await testDb.delete(schema.cronRuns)
  mocks.config = { hasCredentials: true, syncEnabled: true }
  mocks.lockBusy = false
  resetWialonLiveThrottle()
  mocks.refreshWialonPositions.mockReset()
  mocks.refreshWialonPositions.mockResolvedValue({ observedAt: NOW.toISOString(), updated: 3 })
})

describe("refreshWialonLive", () => {
  it("lee posiciones y no escribe en la bitácora del cron", async () => {
    await seedPosition("wialon", "2026-11-09T12:04:00.000Z")

    expect(await refreshWialonLive({ now: NOW })).toEqual({ outcome: "synced", observedAt: NOW.toISOString() })
    expect(mocks.refreshWialonPositions).toHaveBeenCalledWith({ now: NOW, fetchImpl: undefined })
    expect(await testDb.select().from(schema.cronRuns)).toEqual([])
    // Ni una fila por lectura en la bitácora de corridas.
    expect(await testDb.$count(schema.fleetGpsSyncRuns)).toBe(1)
  })

  it("comparte la separación de 9 s entre visitantes y devuelve la marca de captura", async () => {
    await seedPosition("wialon", "2026-11-09T12:04:25.000Z")

    expect(await refreshWialonLive({ now: NOW })).toEqual({
      outcome: "skipped",
      reason: "recent",
      observedAt: "2026-11-09T12:04:25.000Z",
    })
    expect(mocks.refreshWialonPositions).not.toHaveBeenCalled()
  })

  it("la captura de OnWay no cuenta como fresca para Wialon", async () => {
    await seedPosition("onway", "2026-11-09T12:04:29.000Z")

    expect((await refreshWialonLive({ now: NOW })).outcome).toBe("synced")
  })

  it("sin filas en la tabla, un respaldo por proceso evita consultar en cada pedido", async () => {
    expect((await refreshWialonLive({ now: NOW })).outcome).toBe("synced")
    expect(await refreshWialonLive({ now: new Date(NOW.getTime() + 5_000) })).toEqual({ outcome: "skipped", reason: "recent" })
    expect((await refreshWialonLive({ now: new Date(NOW.getTime() + 10_000) })).outcome).toBe("synced")
    expect(mocks.refreshWialonPositions).toHaveBeenCalledTimes(2)
  })

  it("no se adelanta al cron de cada 5 minutos (minutos 2, 7, 12…)", async () => {
    const justBeforeCron = new Date("2026-11-09T12:06:57.000Z")
    expect(await refreshWialonLive({ now: justBeforeCron })).toEqual({ outcome: "skipped", reason: "cron_window" })
    expect(mocks.refreshWialonPositions).not.toHaveBeenCalled()
  })

  it("si el cron tiene el lock, se salta", async () => {
    mocks.lockBusy = true
    expect(await refreshWialonLive({ now: NOW })).toEqual({ outcome: "skipped", reason: "busy" })
    expect(mocks.refreshWialonPositions).not.toHaveBeenCalled()
  })

  it("sin credenciales o con la sincronización apagada no consulta nada", async () => {
    mocks.config = { hasCredentials: false, syncEnabled: true }
    expect(await refreshWialonLive({ now: NOW })).toEqual({ outcome: "disabled", reason: "credentials" })
    mocks.config = { hasCredentials: true, syncEnabled: false }
    expect(await refreshWialonLive({ now: NOW })).toEqual({ outcome: "disabled", reason: "sync_disabled" })
    expect(mocks.refreshWialonPositions).not.toHaveBeenCalled()
  })

  it("una falla de Wialon vuelve con su código, sin lanzar, y no se reintenta de inmediato", async () => {
    mocks.refreshWialonPositions.mockRejectedValue(new WialonClientError("WIALON_TIMEOUT"))
    expect(await refreshWialonLive({ now: NOW })).toEqual({ outcome: "failed", code: "WIALON_TIMEOUT" })
    expect(await refreshWialonLive({ now: new Date(NOW.getTime() + 3_000) })).toEqual({ outcome: "skipped", reason: "recent" })
  })
})

describe("isNearWialonCronSlot", () => {
  it("marca sólo los 5 s previos a cada turno (minuto 2 de cada 5)", () => {
    expect(isNearWialonCronSlot(new Date("2026-11-09T12:06:54.000Z"))).toBe(false)
    expect(isNearWialonCronSlot(new Date("2026-11-09T12:06:55.000Z"))).toBe(true)
    expect(isNearWialonCronSlot(new Date("2026-11-09T12:06:59.999Z"))).toBe(true)
    expect(isNearWialonCronSlot(new Date("2026-11-09T12:07:00.000Z"))).toBe(false)
    expect(isNearWialonCronSlot(new Date("2026-11-09T12:01:57.000Z"))).toBe(true)
  })
})

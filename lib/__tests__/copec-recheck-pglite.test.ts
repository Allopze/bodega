import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime; sólo difiere el HKT del driver.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { getCopecSyncPlan, requestCopecRecheckFrom } = await import("@/lib/combustibles/copec-sync")

const STATE_KEY = "combustibles.copec.sync"

/** Cierra (complete) los cuatro canal/producto de cada mes dado. */
async function closeMonths(months: string[]) {
  for (const month of months) {
    for (const channel of ["TCT", "TAE"] as const) {
      for (const product of ["diesel", "bluemax"] as const) {
        await inMemoryDb.insert(schema.fuelProviderPeriodCoverage).values({
          id: `cov-${month}-${channel}-${product}`,
          provider: "copec",
          sourceAccount: `${channel.toLowerCase()}:${product}`,
          channel,
          product,
          periodMonth: month,
          status: "complete",
          sourceAvailability: "available",
        })
      }
    }
  }
}

async function savedState() {
  const row = await inMemoryDb.query.systemSettings.findFirst({ where: eq(schema.systemSettings.key, STATE_KEY) })
  return row ? JSON.parse(row.value) as { requestedStart: string | null; cursor: string | null } : null
}

async function seedState(requestedStart: string | null) {
  await inMemoryDb.insert(schema.systemSettings).values({
    key: STATE_KEY,
    value: JSON.stringify({ cursor: null, taeCursor: null, requestedStart, lastRunAt: null, pending: [] }),
    updatedAt: "2026-11-10T12:00:00.000Z",
  })
}

describe("re-verificación de Copec desde el mes de un traslado retroactivo", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-18T15:00:00.000Z"))
    vi.stubEnv("COPEC_SYNC_START_DATE", "2026-08-01")
    await inMemoryDb.delete(schema.systemSettings).where(eq(schema.systemSettings.key, STATE_KEY))
    await inMemoryDb.delete(schema.fuelProviderPeriodCoverage)
    await closeMonths(["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"])
  })

  afterAll(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("con el mes anterior ya cerrado, pide revisarlo y el plan empieza ahí", async () => {
    expect((await getCopecSyncPlan()).from).toBe("2026-11-01")

    await expect(requestCopecRecheckFrom("2026-10-01")).resolves.toEqual({ requested: true })

    expect((await getCopecSyncPlan()).from).toBe("2026-10-01")
    expect(await savedState()).toMatchObject({ requestedStart: "2026-10-01" })
  })

  it("no adelanta una revisión que ya empieza antes", async () => {
    await seedState("2026-09-01")

    await expect(requestCopecRecheckFrom("2026-10-01")).resolves.toEqual({ requested: false })

    expect(await savedState()).toMatchObject({ requestedStart: "2026-09-01" })
    expect((await getCopecSyncPlan()).from).toBe("2026-09-01")
  })

  it("sí retrasa el inicio de la revisión hacia un mes más antiguo", async () => {
    await seedState("2026-10-01")

    await expect(requestCopecRecheckFrom("2026-09-01")).resolves.toEqual({ requested: true })

    expect(await savedState()).toMatchObject({ requestedStart: "2026-09-01" })
  })

  it("no pide nada para un mes que el barrido ya iba a revisar", async () => {
    await inMemoryDb.delete(schema.fuelProviderPeriodCoverage).where(eq(schema.fuelProviderPeriodCoverage.periodMonth, "2026-10-01"))

    // Octubre quedó sin cerrar: el barrido ya empieza ahí.
    await expect(requestCopecRecheckFrom("2026-10-01")).resolves.toEqual({ requested: false })
    await expect(requestCopecRecheckFrom("2026-11-01")).resolves.toEqual({ requested: false })
    expect(await savedState()).toBeNull()
  })

  it("no pide nada anterior al inicio configurado de la cuenta", async () => {
    await expect(requestCopecRecheckFrom("2026-07-01")).resolves.toEqual({ requested: false })
    expect(await savedState()).toBeNull()
  })

  it("ignora una fecha que no es el primer día de un mes, sin lanzar", async () => {
    await expect(requestCopecRecheckFrom("2026-10-15")).resolves.toEqual({ requested: false })
    await expect(requestCopecRecheckFrom("no-es-fecha")).resolves.toEqual({ requested: false })
    expect(await savedState()).toBeNull()
  })

  it("dos pedidos casi simultáneos terminan con el mes más antiguo (reintenta ante el choque de versión)", async () => {
    await seedState(null)

    const results = await Promise.all([requestCopecRecheckFrom("2026-10-01"), requestCopecRecheckFrom("2026-09-01")])

    expect(results[1]).toEqual({ requested: true })
    expect(await savedState()).toMatchObject({ requestedStart: "2026-09-01" })
  })

  it("no lanza si la base falla: registra y devuelve requested false", async () => {
    const original = testGlobal.__db
    testGlobal.__db = {
      query: { systemSettings: { findFirst: () => Promise.reject(new Error("db caída")) } },
    } as unknown as typeof inMemoryDb
    try {
      await expect(requestCopecRecheckFrom("2026-10-01")).resolves.toEqual({ requested: false })
    } finally {
      testGlobal.__db = original
    }
  })
})

/**
 * Corrida de cron iniciada a mano, en segundo plano (`startCronJobInBackground`).
 *
 * El botón «Sincronizar» de Copec esperaba la corrida completa dentro de la
 * petición. Detrás de Cloudflare toda petición que pasa de ~100 s se corta
 * (524) y una corrida Copec tarda de 1,5 a 4 minutos: el navegador la daba por
 * perdida aunque el servidor la terminara. Ahora la acción vuelve apenas toma
 * el lock y la pantalla pregunta por `isCronJobRunning`.
 *
 * Contra Postgres real y no PGlite: `isCronJobRunning` depende de que el lock de
 * SESIÓN que toma `withCronLock` en una conexión choque con el lock de
 * TRANSACCIÓN que pide otra conexión. PGlite tiene una sola sesión, y dentro de
 * la misma sesión un advisory lock se vuelve a tomar sin conflicto: ahí la
 * prueba pasaría por la razón equivocada.
 *
 * Requires a real PostgreSQL database.
 * Gate: CRON_LOCK_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.CRON_LOCK_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.CRON_LOCK_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

describeIf("corrida de cron iniciada en segundo plano, sobre Postgres real", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "CRON_LOCK",
    })
    await ensureDatabaseExists(databaseUrl!)
    await resetPublicSchema(databaseUrl!)

    const migrationClient = postgres(databaseUrl!, { max: 1 })
    await migrate(drizzle(migrationClient), {
      migrationsFolder: path.resolve(process.cwd(), "db/migrations"),
    })
    await migrationClient.end()

    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
  }, 180_000)

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
  })

  it("vuelve apenas toma el lock, informa la corrida viva y rechaza una segunda", async () => {
    const { startCronJobInBackground, isCronJobRunning, getCronRunSince } = await import("@/lib/services/cron-lock")
    const since = new Date(Date.now() - 1_000).toISOString()
    let finish: () => void = () => {}
    const gate = new Promise<void>((resolve) => { finish = resolve })
    let finished = false

    const first = await startCronJobInBackground("prueba-boton", async () => {
      await gate
      finished = true
    })
    // La acción ya respondió y la corrida sigue: es lo que evita el 524.
    expect(first).toBe("started")
    expect(finished).toBe(false)
    expect(await isCronJobRunning("prueba-boton")).toBe(true)
    expect((await getCronRunSince("prueba-boton", since))?.outcome).toBe("running")

    // Un segundo clic, o el cron programado, no abre otra sesión del portal.
    expect(await startCronJobInBackground("prueba-boton", async () => { throw new Error("no debía correr") })).toBe("busy")

    finish()
    await vi.waitFor(async () => expect(await isCronJobRunning("prueba-boton")).toBe(false), { timeout: 5_000 })
    expect(finished).toBe(true)
    expect((await getCronRunSince("prueba-boton", since))?.outcome).toBe("success")
  })

  it("una corrida en segundo plano que falla queda en la bitácora con su motivo y suelta el lock", async () => {
    const { startCronJobInBackground, isCronJobRunning, getCronRunSince } = await import("@/lib/services/cron-lock")
    const since = new Date(Date.now() - 1_000).toISOString()
    expect(await startCronJobInBackground("prueba-boton-falla", async () => { throw new Error("Copec no entregó ningún archivo") })).toBe("started")

    await vi.waitFor(async () => expect(await isCronJobRunning("prueba-boton-falla")).toBe(false), { timeout: 5_000 })
    const row = await getCronRunSince("prueba-boton-falla", since)
    expect(row?.outcome).toBe("failed")
    expect(row?.detail).toContain("no entregó ningún archivo")
  })

  it("un job que nadie corre no figura como vivo, y consultarlo no deja el lock tomado", async () => {
    const { isCronJobRunning, withCronLock } = await import("@/lib/services/cron-lock")
    expect(await isCronJobRunning("prueba-libre")).toBe(false)
    // Si la consulta dejara el lock tomado, esta corrida se saltaría.
    expect(await withCronLock("prueba-libre", async () => "corrió")).toBe("corrió")
  })
})

async function resetPublicSchema(url: string) {
  const setupClient = postgres(url, { max: 1 })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`CREATE SCHEMA drizzle`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally {
    await setupClient.end()
  }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1 })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`
      SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1
    `
    if (rows.length === 0) {
      await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
    }
  } finally {
    await maintenanceClient.end()
  }
}

/**
 * Cerco de conversión DTE contra PostgreSQL real.
 *
 * Defiende la secuencia que una simulación de mocks no puede probar:
 * una petición que ya porta credenciales conserva su lease, la conversión
 * pausa inicios nuevos y espera ese lease antes de cifrar/cerrar el corte.
 *
 * Requiere una base explícita y desechable.
 * Gate: DTE_PORTAL_FENCING_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))

const databaseUrl = process.env.DTE_PORTAL_FENCING_DATABASE_URL
const canResetDatabase = process.env.DTE_PORTAL_FENCING_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip
const originalDatabaseUrl = process.env.DATABASE_URL
const originalDteMode = process.env.DTE_SETTINGS_MODE
const originalDteKeyring = process.env.DTE_SETTINGS_KEYRING
const originalDteActiveKey = process.env.DTE_SETTINGS_ACTIVE_KEY_ID

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

describeIf("DTE credential cutover fencing on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "DTE_PORTAL_FENCING",
    })
    await ensureDatabaseExists(databaseUrl!)
    await resetPublicSchema(databaseUrl!)

    const migrationClient = postgres(databaseUrl!, { max: 1 })
    await migrate(drizzle(migrationClient), {
      migrationsFolder: path.resolve(process.cwd(), "db/migrations"),
    })
    await migrationClient.end()

    client = postgres(databaseUrl!, { max: 10 })
    testDb = drizzle(client, { schema })
    process.env.DATABASE_URL = databaseUrl
    process.env.DTE_SETTINGS_MODE = "compat"
    process.env.DTE_SETTINGS_ACTIVE_KEY_ID = "cutover-test-key"
    process.env.DTE_SETTINGS_KEYRING = JSON.stringify({
      "cutover-test-key": Buffer.alloc(32, 7).toString("base64url"),
    })
    ;(globalThis as typeof globalThis & { __db?: unknown }).__db = undefined
    vi.resetModules()
  }, 120_000)

  afterAll(async () => {
    ;(globalThis as typeof globalThis & { __db?: unknown }).__db = undefined
    restoreEnv("DATABASE_URL", originalDatabaseUrl)
    restoreEnv("DTE_SETTINGS_MODE", originalDteMode)
    restoreEnv("DTE_SETTINGS_KEYRING", originalDteKeyring)
    restoreEnv("DTE_SETTINGS_ACTIVE_KEY_ID", originalDteActiveKey)
    await client?.end()
  })

  it("waits for an in-flight portal lease, then blocks every new start before converting secrets", async () => {
    const db = getTestDb()
    const now = new Date().toISOString()
    await db.insert(schema.systemSettings).values([
      { key: "dte.rut_usr", value: "11111111-1", updatedAt: now },
      { key: "dte.rut_emp", value: "78023530-6", updatedAt: now },
      { key: "dte.clave", value: "legacy-password", updatedAt: now },
      { key: "dte.cod_emp", value: "433", updatedAt: now },
      { key: "dte.sync_enabled", value: "true", updatedAt: now },
    ])

    const { withDtePortalOperationLease, assertDtePortalStartsAllowed } = await import("@/lib/services/dte-portal/operation-lease")
    const { convertLegacyDteSettings } = await import("@/lib/services/dte-portal/settings")
    const { claimDteSyncStart } = await import("@/lib/services/dte-portal/sync-start-gate")

    let releaseRequest!: () => void
    const requestReleased = new Promise<void>((resolve) => { releaseRequest = resolve })
    let requestEntered!: () => void
    const requestStarted = new Promise<void>((resolve) => { requestEntered = resolve })
    const inFlightRequest = withDtePortalOperationLease("query", 10_000, async () => {
      requestEntered()
      await requestReleased
      return "done"
    })
    await requestStarted

    let conversionSettled = false
    const conversion = convertLegacyDteSettings({ userId: "cutover-admin" })
      .finally(() => { conversionSettled = true })

    try {
      await waitUntil(async () => {
        const [barrier] = await db
          .select({ value: schema.systemSettings.value })
          .from(schema.systemSettings)
          .where(eq(schema.systemSettings.key, "dte.sync_start_barrier"))
        return barrier?.value === "cutover"
      })
      // The pause is durable, but the conversion must still be waiting for the
      // actual external operation rather than trusting `dte_sync_runs` history.
      expect(conversionSettled).toBe(false)

      releaseRequest()
      await expect(inFlightRequest).resolves.toBe("done")
      await expect(conversion).resolves.toEqual({ converted: 4, keyId: "cutover-test-key" })
    } finally {
      releaseRequest?.()
      await inFlightRequest.catch(() => undefined)
      await conversion.catch(() => undefined)
    }

    await expect(assertDtePortalStartsAllowed()).rejects.toMatchObject({
      code: "DTE_PORTAL_STARTS_PAUSED",
    })
    await expect(claimDteSyncStart({
      runId: "post-cutover-run",
      periodo: "2026-08",
      codEmp: "433",
      trigger: "cron",
      correlationId: "batch-post-cutover",
    })).resolves.toEqual({ allowed: false, reason: "disabled" })

    const stored = await db.select({ key: schema.systemSettings.key, value: schema.systemSettings.value })
      .from(schema.systemSettings)
      .where(sql`${schema.systemSettings.key} like 'dte.%'`)
    expect(stored.find((row) => row.key === "dte.encryption_mode")?.value).toBe("encrypted_only")
    expect(stored.find((row) => row.key === "dte.clave")?.value).toMatch(/^enc:v1:cutover-test-key:/)
    expect(stored.map((row) => row.value).join(" ")).not.toContain("legacy-password")
  })
})

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("Timed out waiting for DTE cutover state")
}

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

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

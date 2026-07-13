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

const databaseUrl = process.env.RATE_LIMIT_CONCURRENCY_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.RATE_LIMIT_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

describeIf("rate limit concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "RATE_LIMIT_CONCURRENCY",
    })
    await ensureDatabaseExists(databaseUrl!)
    await resetPublicSchema(databaseUrl!)

    const migrationClient = postgres(databaseUrl!, { max: 1 })
    await migrate(drizzle(migrationClient), {
      migrationsFolder: path.resolve(process.cwd(), "db/migrations"),
    })
    await migrationClient.end()

    client = postgres(databaseUrl!, { max: 12 })
    testDb = drizzle(client, { schema })

    const globalWithDb = globalThis as typeof globalThis & {
      __db?: ReturnType<typeof drizzle<typeof schema>>
    }
    globalWithDb.__db = undefined
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
  })

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    await client?.end()
  })

  it("records simultaneous failures without duplicate-key errors or lost locking", async () => {
    const db = getTestDb()
    const { checkRateLimit, recordFailure } = await import("@/lib/services/rate-limit")
    const key = "login:concurrent@example.test"

    await Promise.all(Array.from({ length: 12 }, () => recordFailure(key)))

    const [row] = await db
      .select()
      .from(schema.rateLimits)
      .where(eq(schema.rateLimits.key, key))

    expect(row).toBeDefined()
    expect(row?.count).toBe(5)
    expect(row?.lockUntil).toBeGreaterThan(Date.now())
    await expect(checkRateLimit(key)).resolves.toMatchObject({ allowed: false })
  })

  it("allows exactly the configured fixed-window volume under concurrency", async () => {
    const db = getTestDb()
    const { consumeFixedWindowLimit } = await import("@/lib/services/rate-limit")
    const key = "tae:submit-volume:concurrent-e2e"

    const results = await Promise.all(Array.from({ length: 150 }, () =>
      consumeFixedWindowLimit(key, { maxAttempts: 120, lockMs: 15 * 60 * 1000 })))

    expect(results.filter((result) => result.allowed)).toHaveLength(120)
    expect(results.filter((result) => !result.allowed)).toHaveLength(30)
    const [row] = await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, key))
    expect(row?.count).toBe(121)
  })
})

function getTestDb() {
  if (!testDb) throw new Error("test DB not initialised")
  return testDb
}

async function ensureDatabaseExists(targetUrl: string) {
  const maintenanceUrl = getMaintenanceDatabaseUrl(targetUrl)
  const dbName = getDatabaseNameFromUrl(targetUrl)
  if (!dbName) throw new Error("Missing database name")

  const admin = postgres(maintenanceUrl, { max: 1 })
  try {
    const exists = await admin<{ exists: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS exists
    `
    if (!exists[0]?.exists) {
      await admin.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(dbName)}`)
    }
  } finally {
    await admin.end()
  }
}

async function resetPublicSchema(targetUrl: string) {
  const setupClient = postgres(targetUrl, { max: 1 })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
  } finally {
    await setupClient.end()
  }
}

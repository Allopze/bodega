/**
 * Serialización real de reproceso y reversa TAE sobre PostgreSQL.
 *
 * Gate destructivo explícito:
 * TAE_IMPORT_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true
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

const databaseUrl = process.env.TAE_IMPORT_CONCURRENCY_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.TAE_IMPORT_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip
const originalDatabaseUrl = process.env.DATABASE_URL

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

describeIf("TAE import reprocess/reversal concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "TAE_IMPORT_CONCURRENCY",
    })
    await ensureDatabaseExists(databaseUrl!)
    await resetPublicSchema(databaseUrl!)

    const migrationClient = postgres(databaseUrl!, { max: 1 })
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    await migrationClient.end()

    client = postgres(databaseUrl!, { max: 10 })
    testDb = drizzle(client, { schema })
    process.env.DATABASE_URL = databaseUrl
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    vi.resetModules()
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }))
    vi.doMock("@/lib/auth/can", () => ({
      guardPermission: vi.fn(async () => ({
        session: { user: { id: "user-tae-concurrency", email: "tae-concurrency@example.test", isGlobal: true, worksiteIds: [], roles: [], permissions: ["combustibles:tae_import", "combustibles:revert"] } },
        error: null,
      })),
      can: vi.fn(() => true),
    }))
  }, 300_000)

  afterAll(async () => {
    vi.doUnmock("next/cache")
    vi.doUnmock("@/lib/auth/can")
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
    await client?.end()
  })

  it("nunca deja cargas asociadas a un lote revertido cuando compite con el reproceso", async () => {
    const db = getTestDb()
    await seedFixture(db)
    const [{ reprocessTaeImportRejectedRows }, { revertTaeImportBatchAction }] = await Promise.all([
      import("@/lib/combustibles/tae-import-service"),
      import("@/app/(app)/combustibles/tae/importar/actions"),
    ])

    const results = await Promise.allSettled([
      reprocessTaeImportRejectedRows({ batchId: "batch-tae-concurrency", userId: "user-tae-concurrency" }),
      revertTaeImportBatchAction("batch-tae-concurrency"),
    ])

    expect(results.some((result) => result.status === "fulfilled")).toBe(true)
    const [batch] = await db.select({ status: schema.fuelTaeImportBatches.status })
      .from(schema.fuelTaeImportBatches)
      .where(eq(schema.fuelTaeImportBatches.id, "batch-tae-concurrency"))
    const submissions = await db.select({ id: schema.fuelTaeSubmissions.id })
      .from(schema.fuelTaeSubmissions)
      .where(eq(schema.fuelTaeSubmissions.importBatchId, "batch-tae-concurrency"))
    expect(batch?.status).toBe("reverted")
    expect(submissions).toHaveLength(0)
  })
})

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
}

async function seedFixture(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await db.insert(schema.users).values({
    id: "user-tae-concurrency",
    name: "TAE concurrency",
    email: "tae-concurrency@example.test",
    hashedPassword: "hash",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.worksites).values({
    id: "worksite-tae-concurrency",
    name: "Faena TAE concurrencia",
    code: "TAE-CONC",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.fuelProducts).values({
    id: "fuel-historical-unspecified",
    code: "HISTORICO-SIN-ESPECIFICAR",
    name: "Combustible histórico sin especificar",
    category: "other",
    unit: "liter",
    isSystem: true,
    isActive: true,
  }).onConflictDoNothing()
  await db.insert(schema.fuelTaeImportBatches).values({
    id: "batch-tae-concurrency",
    fileName: "tae-concurrency.xlsx",
    fileHash: "hash-tae-concurrency",
    status: "imported",
    totalRows: 1,
    validRows: 0,
    observedRows: 0,
    invalidRows: 1,
    totalLiters: 0,
    importedBy: "user-tae-concurrency",
  })
  await db.insert(schema.fuelTaeImportRejections).values({
    id: "rejection-tae-concurrency",
    batchId: "batch-tae-concurrency",
    rowIndex: 2,
    stage: "worksite",
    field: "Faena",
    message: "Faena pendiente de homologación",
    legacySourceId: "legacy-tae-concurrency",
    rawRow: {
      ID: "legacy-tae-concurrency",
      Faena: "Faena TAE concurrencia",
      "Fecha y hora": "2026-08-20 10:00",
      "Lugar de carga": "Punto TAE",
      "Supervisor / líder": "Supervisión histórica",
      Conductor: "Conductor histórico",
      Equipo: "EQ-HIST-1",
      Odómetro: "1000",
      Litros: "100",
    },
  })
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
    if (rows.length === 0) await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
  } finally {
    await maintenanceClient.end()
  }
}

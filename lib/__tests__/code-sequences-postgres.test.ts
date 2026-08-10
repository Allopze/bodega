/**
 * Catalog test for `listCodeSequences`/`setCodeSequenceNextValue`.
 *
 * Bajo PGlite, las secuencias que crea `next_document_code()` funcionan
 * (nextval avanza correctamente — ver `code-sequences.test.ts`) pero no
 * aparecen en `pg_sequences`/`pg_class`: el catálogo de sistema que estas dos
 * funciones de admin consultan directamente no está poblado igual que en un
 * Postgres real bajo la cadena de migraciones. Este caso vive aquí, contra
 * Postgres real, en vez de en el proyecto PGlite (TST-3).
 *
 * Requires a real PostgreSQL database.
 * Gate: CODE_SEQUENCES_ALLOW_DESTRUCTIVE_RESET=true
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
import type { Tx } from "@/db"

const databaseUrl = process.env.CODE_SEQUENCES_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.CODE_SEQUENCES_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

describeIf("code sequence catalog on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "CODE_SEQUENCES",
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
  })

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
  })

  it("lists and sets code sequences natively", async () => {
    const { nextCodeTx } = await import("@/lib/code-sequences")
    const { listCodeSequences, setCodeSequenceNextValue } = await import("@/lib/code-sequences")
    const { db } = await import("@/db")

    await db.transaction(async (tx) => {
      await nextCodeTx(tx as unknown as Tx, "OC", 2026)
    })

    const initial = await listCodeSequences()
    expect(initial).toContainEqual({ prefix: "OC", year: 2026, nextValue: 2, updatedAt: "" })

    const { before, after } = await setCodeSequenceNextValue({ prefix: "OC", year: 2026, nextValue: 10 })
    expect(before).toBe(2)
    expect(after).toBe(10)

    const updated = await listCodeSequences()
    expect(updated).toContainEqual({ prefix: "OC", year: 2026, nextValue: 10, updatedAt: "" })
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

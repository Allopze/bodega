/**
 * Cierre anual del PDTP contra una reapertura concurrente de un mes
 * (PREV-C03.6, revisión adversarial de la integración T1+T5).
 *
 * `closePdtpProgramYear` toma las versiones del año FOR UPDATE, cuenta los
 * meses cerrados y marca el año. `reopenPdtpPeriod` leía `yearClosedAt` con un
 * SELECT simple: en READ COMMITTED no esperaba al cierre en curso, veía el año
 * abierto y reabría un mes que el cierre ya había contado. El año quedaba
 * cerrado sobre un mes reabierto, y la guarda nueva no vuelve a dispararse.
 *
 * PGlite tiene una sola conexión y no puede reproducirlo: requiere PostgreSQL.
 * Gate: PDTP_YEAR_CLOSE_ALLOW_DESTRUCTIVE_RESET=true
 */
import path from "node:path"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PDTP_YEAR_CLOSE_DATABASE_URL
const canResetDatabase = process.env.PDTP_YEAR_CLOSE_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

const USER_ID = "user-pdtp-yc"
const WORKSITE_ID = "ws-pdtp-yc"
const PROGRAM_ID = "pdtp-yc-2074"
const CLOSURE_ID = "closure-pdtp-yc-12"

let client: postgres.Sql | undefined

describeIf("cierre anual PDTP contra reapertura concurrente (Postgres real)", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "PDTP_YEAR_CLOSE",
    })
    await ensureDatabaseExists(databaseUrl!)
    await resetPublicSchema(databaseUrl!)

    const migrationClient = postgres(databaseUrl!, { max: 1 })
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    await migrationClient.end()

    client = postgres(databaseUrl!, { max: 10 })
    const testDb = drizzle(client, { schema })
    ;(globalThis as typeof globalThis & { __db?: typeof testDb }).__db = testDb
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()

    const now = new Date().toISOString()
    await testDb.insert(schema.users).values({
      id: USER_ID, name: "Jefatura de prevención", email: "pdtp-yc@test.local",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.worksites).values({ id: WORKSITE_ID, name: "Faena YC", code: "PDTP-YC", isActive: true, createdAt: now, updatedAt: now })
    await testDb.insert(schema.pdtpPrograms).values({
      id: PROGRAM_ID, year: 2074, version: 1, title: "PDTP 2074", status: "active",
      elaboratedByName: "Jefatura", elaboratedByTitle: "Prevencionista", creationMode: "blank",
      complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
      createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.pdtpPeriodClosures).values({
      id: CLOSURE_ID, programId: PROGRAM_ID, worksiteId: WORKSITE_ID, year: 2074, month: 12,
      status: "closed", snapshotJson: {}, digest: "a".repeat(64), closedByUserId: USER_ID,
      closedAt: now, closeReason: "Cierre de diciembre", createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => {
    delete (globalThis as typeof globalThis & { __db?: unknown }).__db
    await client?.end()
  })

  it("una reapertura que llega mientras se cierra el año espera y luego la rechaza", async () => {
    const { reopenPdtpPeriod } = await import("@/lib/services/pdtp/period-closures")

    let reopen: Promise<unknown> | undefined
    let settled = false
    await client!.begin(async (tx) => {
      // Lo que hace `closePdtpProgramYear` antes de contar los meses.
      await tx`SELECT id FROM pdtp_programs WHERE year = 2074 FOR UPDATE`
      reopen = reopenPdtpPeriod(
        { closureId: CLOSURE_ID, reason: "Corrección de un registro de diciembre" },
        USER_ID,
        "all",
      ).finally(() => { settled = true })
      reopen.catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 400))
      // Mientras el cierre anual no confirma, la reapertura no puede avanzar.
      expect(settled).toBe(false)
      await tx`UPDATE pdtp_programs
        SET status = 'closed', year_closed_at = now(), year_closed_by_user_id = ${USER_ID}, year_close_reason = 'Cierre anual revisado'
        WHERE id = ${PROGRAM_ID}`
    })

    await expect(reopen).rejects.toThrow(/cerrado formalmente/)
    const [closure] = await client!`SELECT status FROM pdtp_period_closures WHERE id = ${CLOSURE_ID}`
    expect(closure?.status).toBe("closed")
  })
})

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

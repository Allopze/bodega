/**
 * Acreditación de un hecho tardío contra un cierre anual concurrente
 * (PREV-C03.5/C03.6, tanda T3).
 *
 * `resolvePdtpActiveProgramForEvent` leía `yearClosedAt` con un SELECT simple.
 * En READ COMMITTED no espera al `FOR UPDATE` de `closePdtpProgramYear`: veía
 * el año abierto y escribía la ejecución en un año que se estaba cerrando. Es
 * el mismo defecto que ya se corrigió en `reopenPdtpPeriod`, y la misma
 * corrección: tomar la fila del programa `FOR SHARE` dentro de la transacción
 * que escribe.
 *
 * PGlite tiene una sola conexión y no puede reproducirlo: requiere PostgreSQL.
 * Gate: PDTP_ACCREDIT_YEAR_CLOSE_ALLOW_DESTRUCTIVE_RESET=true
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

const databaseUrl = process.env.PDTP_ACCREDIT_YEAR_CLOSE_DATABASE_URL
const canResetDatabase = process.env.PDTP_ACCREDIT_YEAR_CLOSE_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

const USER_ID = "user-pdtp-ayc"
const WORKSITE_ID = "ws-pdtp-ayc"
const PROGRAM_ID = "pdtp-ayc-2074"
const ACTIVITY_ID = "pdtp-ayc-2074-a-042"

let client: postgres.Sql | undefined

describeIf("acreditación contra cierre anual concurrente (Postgres real)", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "PDTP_ACCREDIT_YEAR_CLOSE",
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
      id: USER_ID, name: "Jefatura de prevención", email: "pdtp-ayc@test.local",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.worksites).values({ id: WORKSITE_ID, name: "Faena AYC", code: "PDTP-AYC", isActive: true, createdAt: now, updatedAt: now })
    await testDb.insert(schema.pdtpPrograms).values({
      id: PROGRAM_ID, year: 2074, version: 1, title: "PDTP 2074", status: "active", appliesToAllWorksites: true,
      elaboratedByName: "Jefatura", elaboratedByTitle: "Prevencionista", creationMode: "blank",
      complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
      createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.pdtpActivities).values({
      id: ACTIVITY_ID, programId: PROGRAM_ID, n: 42, activity: "Campaña de prueba", program: "Prevención",
      responsibleSlugs: [], responsibleDisplay: "Prevencionista", scheduleMode: "triggered",
      scheduleClassificationStatus: "confirmed", sourceSheetRow: 1, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => {
    delete (globalThis as typeof globalThis & { __db?: unknown }).__db
    await client?.end()
  })

  it("un hecho que llega mientras se cierra el año espera y queda rechazado por año cerrado", async () => {
    const { accreditPdtpFromEvent } = await import("@/lib/services/pdtp/accreditation")

    let accreditation: Promise<Awaited<ReturnType<typeof accreditPdtpFromEvent>>> | undefined
    let settled = false
    await client!.begin(async (tx) => {
      // Lo que hace `closePdtpProgramYear` antes de contar los meses.
      await tx`SELECT id FROM pdtp_programs WHERE year = 2074 FOR UPDATE`
      accreditation = accreditPdtpFromEvent({
        sourceType: "campana",
        sourceId: "campana-tardia",
        worksiteId: WORKSITE_ID,
        activityNumbers: [42],
        occurredAt: "2074-12-20T15:00:00.000Z",
      }).finally(() => { settled = true })
      accreditation.catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 400))
      // Mientras el cierre anual no confirma, el hecho no puede escribirse.
      expect(settled).toBe(false)
      await tx`UPDATE pdtp_programs
        SET status = 'closed', year_closed_at = now(), year_closed_by_user_id = ${USER_ID}, year_close_reason = 'Cierre anual revisado'
        WHERE id = ${PROGRAM_ID}`
    })

    const result = await accreditation!
    expect(result.accredited).toEqual([])
    expect(result.skippedYearClosed).toMatchObject({ occurredYear: 2074, programId: PROGRAM_ID })
    const executions = await client!`SELECT id FROM pdtp_executions WHERE activity_id = ${ACTIVITY_ID}`
    expect(executions).toHaveLength(0)
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

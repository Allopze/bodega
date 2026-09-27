/**
 * Ventana por versión (PREV-C05-B, T6) contra la activación concurrente de
 * una revisión v+1.
 *
 * Una escritura sobre la v1 (ejecución o desvío) valida la ventana antes de
 * abrir su transacción. Si justo entonces se activa la v2, la v1 queda cerrada
 * con sucesora y la semana de activación ya es de la v2: leída sin lock, la
 * escritura caía igual en la v1, sobre semanas que nadie mide y que el
 * traspaso de la activación (C05-D) no vio. La ventana se relee dentro de la
 * transacción con la fila del programa `FOR SHARE`, en serie con el UPDATE
 * que cierra la v1.
 *
 * PGlite tiene una sola conexión y no puede reproducirlo: requiere PostgreSQL.
 * Gate: PDTP_REVISION_WINDOW_ALLOW_DESTRUCTIVE_RESET=true
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
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

const databaseUrl = process.env.PDTP_REVISION_WINDOW_DATABASE_URL
const canResetDatabase = process.env.PDTP_REVISION_WINDOW_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

process.env.STORAGE_PATH = path.join(tmpdir(), `pdtp-revision-window-pg-${Date.now()}`)
mkdirSync(path.join(process.env.STORAGE_PATH, "pdtp-evidence"), { recursive: true })
writeFileSync(path.join(process.env.STORAGE_PATH, "pdtp-evidence", "acta.pdf"), "%PDF-1.4")
const EVIDENCE_URL = "storage/pdtp-evidence/acta.pdf"

const USER_ID = "user-pdtp-rw"
const WORKSITE_ID = "ws-pdtp-rw"
const YEAR = 2074
const V1 = "pdtp-rw-2074-v1"
const V2 = "pdtp-rw-2074-v2"
const V1_ACTIVITY = `${V1}-a-001`
/** Semana 2 de junio (día 10): desde ahí manda la v2. */
const V2_ACTIVATED_AT = `${YEAR}-06-10T15:00:00.000Z`

let client: postgres.Sql | undefined

describeIf("ventana de la v1 contra la activación concurrente de la v2 (Postgres real)", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "PDTP_REVISION_WINDOW",
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
      id: USER_ID, name: "Prevencionista", email: "pdtp-rw@test.local",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.worksites).values({ id: WORKSITE_ID, name: "Faena RW", code: "PDTP-RW", isActive: true, createdAt: now, updatedAt: now })
    const program = {
      year: YEAR, elaboratedByName: "Jefatura", elaboratedByTitle: "Prevencionista", creationMode: "blank",
      complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
      appliesToAllWorksites: true, createdAt: now, updatedAt: now,
    }
    await testDb.insert(schema.pdtpPrograms).values([
      { ...program, id: V1, version: 1, title: "PDTP 2074", status: "active", activatedAt: `${YEAR}-01-05T15:00:00.000Z` },
      { ...program, id: V2, version: 2, title: "PDTP 2074 v2", status: "in_review", sourceProgramId: V1, sourceContentVersion: 1 },
    ])
    await testDb.insert(schema.pdtpActivities).values({
      id: V1_ACTIVITY, programId: V1, n: 1, activity: "Charla de seguridad", program: "Guía",
      responsibleSlugs: [], responsibleDisplay: "Prevencionista", scheduleMode: "scheduled",
      scheduleClassificationStatus: "confirmed", sourceSheetRow: 1, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => {
    delete (globalThis as typeof globalThis & { __db?: unknown }).__db
    await client?.end()
  })

  it("una ejecución de la v1 que llega mientras se activa la v2 espera y luego se rechaza", async () => {
    const { markPdtpExecution } = await import("@/lib/services/pdtp/executions")

    let write: Promise<unknown> | undefined
    let settled = false
    await client!.begin(async (tx) => {
      // Lo que hace `activatePdtpProgram`: cierra la vigente y activa la nueva.
      await tx`UPDATE pdtp_programs SET status = 'closed' WHERE id = ${V1}`
      write = markPdtpExecution({
        activityId: V1_ACTIVITY, worksiteId: WORKSITE_ID, year: YEAR, month: 6, week: 3,
        executedQuantity: 1, evidenceUrl: EVIDENCE_URL,
      }, USER_ID, "all", { canActForOthers: true }).finally(() => { settled = true })
      write.catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 400))
      // Mientras la activación no confirma, la escritura no puede decidir.
      expect(settled).toBe(false)
      await tx`UPDATE pdtp_programs SET status = 'active', activated_at = ${V2_ACTIVATED_AT} WHERE id = ${V2}`
    })

    await expect(write).rejects.toThrow(/versión v2/)
    const rows = await client!`SELECT id FROM pdtp_executions WHERE activity_id = ${V1_ACTIVITY}`
    expect(rows).toHaveLength(0)
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

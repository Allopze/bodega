/**
 * Concurrencia del reporte de incidentes y del envío de PPA.
 *
 * Ambas colas offline se apoyan en la MISMA garantía: reintentar un envío con la
 * misma `clientSubmissionId` no duplica el registro. Esa garantía vive en una
 * rama (`onConflictDoNothing` + recuperación de la fila existente) que ningún
 * test ejercitaba bajo contención real — dos pestañas sincronizando a la vez es
 * exactamente ese escenario. Un cambio de índice la rompería sin poner nada en
 * rojo.
 *
 * Requiere PostgreSQL real.
 * Gate: PREVENTION_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET=true
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

const databaseUrl = process.env.PREVENTION_CONCURRENCY_DATABASE_URL ?? process.env.DATABASE_URL
const canResetDatabase = process.env.PREVENTION_CONCURRENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const ACCESS = {
  ctx: { userId: "user-pc-test" },
  scope: { mode: "all" as const, ids: [] as [] },
  permissions: ["prevention:incidents:report", "prevention:incidents:view"],
}

describeIf("prevention concurrency on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "PREVENTION_CONCURRENCY",
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

    const globalWithDb = globalThis as typeof globalThis & {
      __db?: ReturnType<typeof drizzle<typeof schema>>
    }
    globalWithDb.__db = testDb
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()

    const now = new Date().toISOString()
    await testDb.insert(schema.users).values({
      id: "user-pc-test", name: "Prevencion Concurrencia",
      email: "prevencion-concurrencia@test.local", hashedPassword: "hash",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.worksites).values({
      id: "ws-pc-test", name: "Faena concurrencia prevencion", code: "PC-TEST",
      isActive: true, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    await client?.end()
  })

  it("dos reportes con la misma clave de sincronización crean UN solo incidente", async () => {
    const db = getTestDb()
    const { reportPreventionIncident } = await import("@/lib/services/prevention-incidents")

    const payload = {
      clientSubmissionId: "offline-pc-duplicado-001",
      worksiteId: "ws-pc-test",
      companyName: "Chome",
      eventType: "dangerous_incident" as const,
      occurredAt: "2026-08-10T12:00:00.000Z",
      knownAt: "2026-08-10T12:30:00.000Z",
      location: "Frente de trabajo",
      initialNarrative: "Relato de prueba para la carrera de sincronización offline.",
      actualSeverity: "none" as const,
      potentialSeverity: "low" as const,
      immediateMeasures: null,
      operationsSuspended: false,
      evacuated: false,
      isFatalOrSerious: false,
      offlineSync: true,
      people: [],
    }

    const results = await Promise.allSettled([
      reportPreventionIncident({ input: payload, access: ACCESS }),
      reportPreventionIncident({ input: payload, access: ACCESS }),
    ])

    // Ninguna debe fallar: la perdedora recupera la fila original.
    const fulfilled = results.filter((r) => r.status === "fulfilled")
    if (fulfilled.length !== 2) {
      const reasons = results.filter((r) => r.status === "rejected")
        .map((r) => String((r as PromiseRejectedResult).reason))
      throw new Error(`Se esperaban 2 cumplidas; motivos: ${reasons.join(" | ")}`)
    }

    const rows = await db.select().from(schema.preventionIncidents)
      .where(eq(schema.preventionIncidents.clientSubmissionId, payload.clientSubmissionId))
    expect(rows).toHaveLength(1)

    // Exactamente una de las dos debe declararse replay idempotente.
    const replays = fulfilled.filter((r) =>
      (r as PromiseFulfilledResult<{ idempotentReplay?: boolean }>).value.idempotentReplay === true)
    expect(replays).toHaveLength(1)
  })
})

function getTestDb() {
  if (!testDb) throw new Error("Postgres test DB was not initialized")
  return testDb
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

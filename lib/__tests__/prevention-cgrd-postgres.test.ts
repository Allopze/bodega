/**
 * Real PostgreSQL proof for CGRD: un solo comité activo y una sola matriz
 * publicada por faena (índices únicos parciales), y el ciclo completo de
 * publicación con reemplazo (supersede). PGlite ya lo cubre funcionalmente en
 * `prevention-cgrd.test.ts`; esta suite corre contra Postgres real por el
 * mismo motivo que `prevention-cphs-postgres.test.ts` y
 * `prevention-risk-postgres.test.ts` — sin esto el `describeIf` salta en
 * verde si nadie define las variables de entorno, un fallo silencioso que ya
 * ocurrió antes en este repo.
 */
import path from "node:path"
import postgres from "postgres"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PREVENTION_CGRD_DATABASE_URL
const canReset = process.env.PREVENTION_CGRD_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const scopeA = { mode: "some", ids: ["ws-grdpg-a"] } as WorksiteScope
const scopeAll = { mode: "all", ids: [] } as WorksiteScope
const MANAGER = { userId: "grdpg-manager", scope: scopeA, permissions: ["prevention:cgrd:view", "prevention:cgrd:committee:manage", "prevention:cgrd:matrix:edit", "prevention:cgrd:meeting:manage"] }
const REVIEWER = { userId: "grdpg-reviewer", scope: scopeAll, permissions: ["prevention:cgrd:view", "prevention:cgrd:matrix:review"] }
const APPROVER = { userId: "grdpg-approver", scope: scopeAll, permissions: ["prevention:cgrd:view", "prevention:cgrd:matrix:approve"] }
/* Publicar dejó de poder hacerlo quien aprobó: la cuarta firma se segrega por
 * actor, igual que las tres anteriores. */
const PUBLISHER = { userId: "grdpg-publisher", scope: scopeAll, permissions: ["prevention:cgrd:view", "prevention:cgrd:matrix:publish"] }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

describeIf("CGRD sobre PostgreSQL real", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_CGRD" })
    await ensureDatabaseExists(databaseUrl!)
    await resetDatabase(databaseUrl!)
    const migrationClient = postgres(databaseUrl!, { max: 1, onnotice: () => undefined })
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    await migrationClient.end()
    client = postgres(databaseUrl!, { max: 10, onnotice: () => undefined })
    testDb = drizzle(client, { schema })
    ;(globalThis as typeof globalThis & { __db?: typeof testDb }).__db = testDb
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
    await seedFixture(getDb())
  }, 60_000)

  afterAll(async () => {
    ;(globalThis as typeof globalThis & { __db?: unknown }).__db = undefined
    await client?.end()
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  })

  it("constituye un comité y rechaza un segundo comité activo en la misma faena", async () => {
    const service = await import("@/lib/services/prevention-cgrd")
    const committee = await service.constituteGrdCommittee({
      worksiteId: "ws-grdpg-a", name: "CGRD Faena Norte", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01",
    }, MANAGER)
    expect(committee.status).toBe("active")

    await expect(service.constituteGrdCommittee({
      worksiteId: "ws-grdpg-a", name: "Segundo CGRD", constitutedOn: "2026-03-02", mandateEndsOn: "2028-03-02",
    }, MANAGER)).rejects.toThrow()

    const executions = await getDb().select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, "pdtp-grdpg-v1-a-79"))
    expect(executions).toHaveLength(1)
  })

  it("publica la matriz, la segunda versión reemplaza a la primera — una sola publicada por faena", async () => {
    const service = await import("@/lib/services/prevention-cgrd")

    const first = await service.createGrdMatrixDraft({ worksiteId: "ws-grdpg-a", title: "Matriz GRD v1", revisionReason: "Primera versión de prueba" }, MANAGER)
    await service.addGrdThreat({ matrixId: first.id, name: "Incendio forestal", origin: "obligatoria", historicalAnalysis: "Antecedentes suficientes", legalRequirement: "Requisito legal aplicable", workPlan: "Plan de trabajo definido" }, MANAGER)
    let matrix = await service.transitionGrdMatrix({ matrixId: first.id, expectedVersion: first.version, toStatus: "in_review", reason: "Envío a revisión de prueba" }, MANAGER)
    matrix = await service.transitionGrdMatrix({ matrixId: first.id, expectedVersion: matrix.version, toStatus: "reviewed", reason: "Revisión técnica de prueba" }, REVIEWER)
    matrix = await service.transitionGrdMatrix({ matrixId: first.id, expectedVersion: matrix.version, toStatus: "approved", reason: "Aprobación de prueba" }, APPROVER)
    const publishedFirst = await service.transitionGrdMatrix({ matrixId: first.id, expectedVersion: matrix.version, toStatus: "published", reason: "Publicación de prueba" }, PUBLISHER)
    expect(publishedFirst.status).toBe("published")
    expect(publishedFirst.publishedHashSha256).toBeTruthy()

    const second = await service.createGrdMatrixDraft({ worksiteId: "ws-grdpg-a", title: "Matriz GRD v2", revisionReason: "Segunda versión de prueba" }, MANAGER)
    await service.addGrdThreat({ matrixId: second.id, name: "Aluvión", origin: "detectada", historicalAnalysis: "Antecedentes suficientes", legalRequirement: "Requisito legal aplicable", workPlan: "Plan de trabajo definido" }, MANAGER)
    let secondMatrix = await service.transitionGrdMatrix({ matrixId: second.id, expectedVersion: second.version, toStatus: "in_review", reason: "Envío a revisión de prueba" }, MANAGER)
    secondMatrix = await service.transitionGrdMatrix({ matrixId: second.id, expectedVersion: secondMatrix.version, toStatus: "reviewed", reason: "Revisión técnica de prueba" }, REVIEWER)
    secondMatrix = await service.transitionGrdMatrix({ matrixId: second.id, expectedVersion: secondMatrix.version, toStatus: "approved", reason: "Aprobación de prueba" }, APPROVER)
    await service.transitionGrdMatrix({ matrixId: second.id, expectedVersion: secondMatrix.version, toStatus: "published", reason: "Publicación de prueba" }, PUBLISHER)

    const [firstAfter] = await getDb().select().from(schema.preventionGrdMatrices).where(eq(schema.preventionGrdMatrices.id, first.id))
    expect(firstAfter?.status).toBe("superseded")

    const publishedRows = await getDb().select().from(schema.preventionGrdMatrices).where(eq(schema.preventionGrdMatrices.worksiteId, "ws-grdpg-a"))
    expect(publishedRows.filter((row) => row.status === "published")).toHaveLength(1)

    const executions = await getDb().select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, "pdtp-grdpg-v1-a-80"))
    expect(executions).toHaveLength(2)
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-grdpg-a", name: "Faena Norte", code: "GRDPG-A", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "grdpg-manager", name: "Gestor CGRD", email: "grdpg-manager@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "grdpg-reviewer", name: "Revisor CGRD", email: "grdpg-reviewer@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "grdpg-approver", name: "Aprobador CGRD", email: "grdpg-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "grdpg-publisher", name: "Publicador CGRD", email: "grdpg-publisher@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.pdtpPrograms).values({
    id: "pdtp-grdpg-v1", version: 1, year: 2026, title: "PDTP 2026 CGRD-postgres",
    status: "active", elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: now, updatedAt: now,
  })
  await database.insert(schema.pdtpActivities).values([
    { id: "pdtp-grdpg-v1-a-79", programId: "pdtp-grdpg-v1", n: 79, activity: "Constitución CGRD", program: "Prevención PDTP", responsibleSlugs: ["prf"], responsibleDisplay: "PRF", scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed", mechanism: "enganche", sourceSheetRow: 1, createdAt: now, updatedAt: now },
    { id: "pdtp-grdpg-v1-a-80", programId: "pdtp-grdpg-v1", n: 80, activity: "Matriz GRD", program: "Prevención PDTP", responsibleSlugs: ["prf"], responsibleDisplay: "PRF", scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed", mechanism: "enganche", sourceSheetRow: 1, createdAt: now, updatedAt: now },
    { id: "pdtp-grdpg-v1-a-81", programId: "pdtp-grdpg-v1", n: 81, activity: "Actas CGRD", program: "Prevención PDTP", responsibleSlugs: ["prf"], responsibleDisplay: "PRF", scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed", mechanism: "enganche", sourceSheetRow: 1, createdAt: now, updatedAt: now },
  ])
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1, onnotice: () => undefined })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(`CREATE SCHEMA public`)
    await setupDb.execute(`CREATE SCHEMA drizzle`)
    await setupDb.execute(`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally { await setupClient.end() }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1, onnotice: () => undefined })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1`
    if (rows.length === 0) await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
  } finally { await maintenanceClient.end() }
}

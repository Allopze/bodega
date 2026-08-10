/** Real PostgreSQL proof for Gestión del cambio: disponibilidad, segregación de aprobación y derivación a CAPA por dimensión. */
import path from "node:path"
import postgres from "postgres"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { CHANGE_DIMENSIONS } from "@/lib/prevention/change"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PREVENTION_CHANGE_DATABASE_URL
const canReset = process.env.PREVENTION_CHANGE_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const scopeA = { mode: "some", ids: ["ws-chg-a"] } as WorksiteScope
const MANAGER = { userId: "chg-manager", scope: scopeA, permissions: ["prevention:change:view", "prevention:change:manage", "prevention:change:evaluate"] }
const APPROVER = { userId: "chg-approver", scope: { mode: "all", ids: [] } as WorksiteScope, permissions: ["prevention:change:view", "prevention:change:approve"] }
const MANAGER_WITH_APPROVE = { userId: "chg-manager", scope: scopeA, permissions: ["prevention:change:view", "prevention:change:manage", "prevention:change:evaluate", "prevention:change:approve"] }
const OUTSIDER = { userId: "chg-outsider", scope: { mode: "some", ids: ["ws-chg-b"] } as WorksiteScope, permissions: ["prevention:change:view", "prevention:change:manage"] }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

describeIf("Gestión del cambio on real PostgreSQL", () => {
  let changeId = ""
  let changeVersion = 1

  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_CHANGE" })
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

  it("denies creating a change request from a foreign worksite scope", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.createChangeRequest({
      worksiteId: "ws-chg-a", title: "Cambio ajeno", changeType: "proceso",
      description: "Cambio de procedimiento de carga.", reason: "Optimización operacional.",
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  it("creates the change request in draft with the six dimensions pending", async () => {
    const service = await import("@/lib/services/prevention-change")
    const request = await service.createChangeRequest({
      worksiteId: "ws-chg-a", title: "Cambio de proveedor de aislamiento eléctrico", changeType: "proveedor",
      description: "Se cambia el proveedor que suministra los equipos de aislamiento (LOTO).",
      reason: "El proveedor anterior discontinuó la línea de candados certificados.",
      riskLevel: "high",
    }, MANAGER)
    changeId = request.id
    changeVersion = request.version
    expect(request.status).toBe("draft")

    const assessments = await getDb().select().from(schema.preventionChangeAssessments)
      .where(eq(schema.preventionChangeAssessments.changeRequestId, changeId))
    expect(assessments).toHaveLength(CHANGE_DIMENSIONS.length)
    expect(assessments.every((row) => row.evaluated === false)).toBe(true)
  })

  it("refuses to approve a change with no dimension evaluated", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.approveChangeRequest({
      changeRequestId: changeId, expectedVersion: changeVersion, plannedReviewDate: "2026-12-01",
    }, APPROVER)).rejects.toThrow(/Faltan por evaluar/)
  })

  it("evaluating a dimension moves the request to under_evaluation", async () => {
    const service = await import("@/lib/services/prevention-change")
    await service.evaluateChangeDimension({
      changeRequestId: changeId, dimension: "training", impacted: true,
      notes: "Se requiere reentrenar en el uso del nuevo candado.", actionRequired: false,
    }, MANAGER)

    const [request] = await getDb().select().from(schema.preventionChangeRequests).where(eq(schema.preventionChangeRequests.id, changeId))
    expect(request?.status).toBe("under_evaluation")
  })

  it("deriving an action from a dimension links a CAPA action with responsible and target date", async () => {
    const service = await import("@/lib/services/prevention-change")
    const updated = await service.evaluateChangeDimension({
      changeRequestId: changeId, dimension: "permit", impacted: true,
      notes: "Los permisos de trabajo eléctrico deben referenciar el nuevo candado.",
      actionRequired: true, actionDescription: "Actualizar el catálogo de tipos de permiso con el nuevo candado.",
      responsibleUserId: "chg-manager", priority: "high", targetDate: "2026-11-01",
    }, MANAGER)
    expect(updated.capaActionId).toBeTruthy()

    const capa = await getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceType, "change"))
    expect(capa).toHaveLength(1)
    expect(capa[0]?.sourceId).toBe(changeId)
    expect(capa[0]?.worksiteId).toBe("ws-chg-a")
    expect(capa[0]?.targetDate).toBe("2026-11-01")
  })

  it("still refuses approval while four dimensions remain unevaluated", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.approveChangeRequest({
      changeRequestId: changeId, expectedVersion: changeVersion, plannedReviewDate: "2026-12-01",
    }, APPROVER)).rejects.toThrow(/Faltan por evaluar/)
  })

  it("evaluating the remaining dimensions unblocks approval", async () => {
    const service = await import("@/lib/services/prevention-change")
    for (const dimension of ["risk", "document", "miper", "emergency"] as const) {
      await service.evaluateChangeDimension({
        changeRequestId: changeId, dimension, impacted: false, actionRequired: false,
      }, MANAGER)
    }
    const detail = await service.getChangeRequestDetail(changeId, MANAGER)
    expect(detail?.readiness.ready).toBe(false) // aún falta la fecha de revisión, que se declara al aprobar
    expect(detail?.assessments.every((row) => row.evaluated)).toBe(true)
  })

  it("refuses approval by the requester, even holding the approve permission", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.approveChangeRequest({
      changeRequestId: changeId, expectedVersion: changeVersion, plannedReviewDate: "2026-12-01",
    }, MANAGER_WITH_APPROVE)).rejects.toThrow(/no puede aprobarlo/)
  })

  it("approves the change once every dimension is evaluated and a review date is set", async () => {
    const service = await import("@/lib/services/prevention-change")
    const approved = await service.approveChangeRequest({
      changeRequestId: changeId, expectedVersion: changeVersion, plannedReviewDate: "2026-12-01",
    }, APPROVER)
    expect(approved.status).toBe("approved")
    expect(approved.plannedReviewDate).toBe("2026-12-01")
    expect(approved.approvedByUserId).toBe("chg-approver")
  })

  it("rejects evaluating a dimension once the change is already decided", async () => {
    const service = await import("@/lib/services/prevention-change")
    await expect(service.evaluateChangeDimension({
      changeRequestId: changeId, dimension: "risk", impacted: false, actionRequired: false,
    }, MANAGER)).rejects.toThrow(/ya decidido/)
  })

  it("does not leak change requests of another worksite", async () => {
    const service = await import("@/lib/services/prevention-change")
    expect(await service.listChangeRequests(OUTSIDER)).toEqual([])
    expect(await service.getChangeRequestDetail(changeId, OUTSIDER)).toBeNull()
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-chg-a", name: "Faena Norte", code: "CHG-A", createdAt: now, updatedAt: now },
    { id: "ws-chg-b", name: "Faena Sur", code: "CHG-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "chg-manager", name: "Gestor de Cambios", email: "chg-manager@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "chg-approver", name: "Aprobador", email: "chg-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "chg-outsider", name: "Ajeno", email: "chg-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1, onnotice: () => undefined })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`CREATE SCHEMA drizzle`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
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

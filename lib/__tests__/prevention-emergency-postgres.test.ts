/** Real PostgreSQL proof for Emergencias: disponibilidad del plan, segregación de aprobación y cierre de simulacro derivando a CAPA. */
import path from "node:path"
import postgres from "postgres"
import { eq, sql } from "drizzle-orm"
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

const databaseUrl = process.env.PREVENTION_EMERGENCY_DATABASE_URL
const canReset = process.env.PREVENTION_EMERGENCY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const scopeA = { mode: "some", ids: ["ws-em-a"] } as WorksiteScope
const MANAGER = { userId: "em-manager", scope: scopeA, permissions: ["prevention:emergency:view", "prevention:emergency:manage"] }
const APPROVER = { userId: "em-approver", scope: { mode: "all", ids: [] } as WorksiteScope, permissions: ["prevention:emergency:view", "prevention:emergency:approve"] }
// Mismo usuario que crea el plan, pero con el permiso de aprobar: aísla la
// segregación de funciones (servicio) del gate de permisos (RBAC), que ya
// se prueba aparte en `denies creating a plan from a foreign worksite scope`.
const MANAGER_WITH_APPROVE = { userId: "em-manager", scope: scopeA, permissions: ["prevention:emergency:view", "prevention:emergency:manage", "prevention:emergency:approve"] }
const EXECUTOR = { userId: "em-executor", scope: scopeA, permissions: ["prevention:emergency:view", "prevention:emergency:drill_execute"] }
const OUTSIDER = { userId: "em-outsider", scope: { mode: "some", ids: ["ws-em-b"] } as WorksiteScope, permissions: ["prevention:emergency:view", "prevention:emergency:manage"] }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

describeIf("Emergencias on real PostgreSQL", () => {
  let planId = ""
  let planVersion = 1
  let drillId = ""
  let drillVersion = 1

  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_EMERGENCY" })
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

  it("denies creating a plan from a foreign worksite scope", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.createEmergencyPlan({
      worksiteId: "ws-em-a", title: "Plan ajeno",
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  it("creates the plan in draft", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const plan = await service.createEmergencyPlan({
      worksiteId: "ws-em-a", title: "Plan de emergencia Faena Norte",
    }, MANAGER)
    planId = plan.id
    planVersion = plan.version
    expect(plan.status).toBe("draft")
  })

  it("refuses to approve a plan without scenarios nor roles", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.approveEmergencyPlan({
      planId, expectedVersion: planVersion,
    }, APPROVER)).rejects.toThrow(/escenario/)
  })

  it("adds a scenario and a role, rejecting a role assignee from another worksite", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await service.addEmergencyScenario({
      planId, type: "incendio", title: "Incendio en bodega de insumos",
      responseProcedure: "Activar alarma, evacuar por ruta señalizada y usar extintores del sector.",
    }, MANAGER)

    await expect(service.addEmergencyRole({
      planId, roleName: "Jefe de emergencia", assigneeWorkerId: "wk-b1",
    }, MANAGER)).rejects.toThrow(/faena del plan/)

    await service.addEmergencyRole({
      planId, roleName: "Jefe de emergencia", assigneeWorkerId: "wk-a1", backupWorkerId: "wk-a2",
    }, MANAGER)
  })

  it("refuses approval by the plan's own creator, even holding the approve permission", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.approveEmergencyPlan({
      planId, expectedVersion: planVersion,
    }, MANAGER_WITH_APPROVE)).rejects.toThrow(/no puede aprobarlo/)
  })

  it("approves the plan once scenario and role exist, by someone other than its creator", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const approved = await service.approveEmergencyPlan({
      planId, expectedVersion: planVersion,
    }, APPROVER)
    planVersion = approved.version
    expect(approved.status).toBe("approved")
    expect(approved.approvedByUserId).toBe("em-approver")
  })

  it("schedules a drill only once the plan is approved", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const drill = await service.scheduleEmergencyDrill({
      planId, scenarioType: "incendio", scheduledFor: "2026-09-10T14:00:00.000Z",
    }, EXECUTOR)
    drillId = drill.id
    drillVersion = drill.version
    expect(drill.status).toBe("scheduled")
  })

  it("refuses to complete a drill with nobody present", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.completeEmergencyDrill({
      drillId, expectedVersion: drillVersion,
      executedAt: "2026-09-10T14:20:00.000Z",
      outcome: "satisfactory",
      participants: [{ workerId: "wk-a1", present: false }],
    }, EXECUTOR)).rejects.toThrow(/participante/)
  })

  it("completes a drill that needs improvement, deriving a CAPA action with responsible and target date", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    const completed = await service.completeEmergencyDrill({
      drillId, expectedVersion: drillVersion,
      executedAt: "2026-09-10T14:20:00.000Z",
      durationMinutes: 12,
      evacuationSeconds: 240,
      observations: "La ruta de evacuación del sector B estaba parcialmente obstruida.",
      outcome: "needs_improvement",
      participants: [
        { workerId: "wk-a1", present: true },
        { workerId: "wk-a2", present: true },
        { workerId: "wk-a3", present: false },
      ],
      responsibleUserId: "em-manager",
      targetDate: "2026-10-15",
    }, EXECUTOR)
    expect(completed.status).toBe("completed")
    expect(completed.capaActionId).toBeTruthy()

    const capa = await getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceType, "emergency"))
    expect(capa).toHaveLength(1)
    expect(capa[0]?.sourceId).toBe(drillId)
    expect(capa[0]?.worksiteId).toBe("ws-em-a")
    expect(capa[0]?.targetDate).toBe("2026-10-15")
  })

  it("rejects completing the same drill twice", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    await expect(service.completeEmergencyDrill({
      drillId, expectedVersion: 99,
      executedAt: "2026-09-10T14:20:00.000Z",
      outcome: "satisfactory",
      participants: [{ workerId: "wk-a1", present: true }],
    }, EXECUTOR)).rejects.toThrow()
  })

  it("does not leak plans of another worksite", async () => {
    const service = await import("@/lib/services/prevention-emergency")
    expect(await service.listEmergencyPlans(OUTSIDER)).toEqual([])
    expect(await service.getEmergencyPlanDetail(planId, OUTSIDER)).toBeNull()
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-em-a", name: "Faena Norte", code: "EM-A", createdAt: now, updatedAt: now },
    { id: "ws-em-b", name: "Faena Sur", code: "EM-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.workers).values([
    { id: "wk-a1", rut: "11111111-1", firstName: "Ana", lastName: "Pérez", worksiteId: "ws-em-a", createdAt: now },
    { id: "wk-a2", rut: "22222222-2", firstName: "Bruno", lastName: "Soto", worksiteId: "ws-em-a", createdAt: now },
    { id: "wk-a3", rut: "33333333-3", firstName: "Carla", lastName: "Díaz", worksiteId: "ws-em-a", createdAt: now },
    { id: "wk-b1", rut: "66666666-6", firstName: "Felipe", lastName: "Vera", worksiteId: "ws-em-b", createdAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "em-manager", name: "Gestor de Emergencias", email: "em-manager@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "em-approver", name: "Aprobador", email: "em-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "em-executor", name: "Ejecutor de simulacros", email: "em-executor@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "em-outsider", name: "Ajeno", email: "em-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
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

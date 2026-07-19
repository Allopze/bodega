/** Real PostgreSQL proof for industrial hygiene: exposure limits, GES and surveillance. */
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

const databaseUrl = process.env.PREVENTION_HYGIENE_DATABASE_URL
const canReset = process.env.PREVENTION_HYGIENE_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const scopeA = { mode: "some", ids: ["ws-hy-a"] } as WorksiteScope
const HYGIENIST = { userId: "hy-manager", scope: scopeA, permissions: ["prevention:hygiene:view", "prevention:hygiene:manage", "prevention:hygiene:measure"] }
const VIEWER = { userId: "hy-viewer", scope: scopeA, permissions: ["prevention:hygiene:view"] }
const OUTSIDER = { userId: "hy-outsider", scope: { mode: "some", ids: ["ws-hy-b"] } as WorksiteScope, permissions: ["prevention:hygiene:view", "prevention:hygiene:manage", "prevention:hygiene:measure"] }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

describeIf("Higiene industrial on real PostgreSQL", () => {
  let agentId = ""
  let uncappedAgentId = ""
  let groupId = ""
  let smallGroupId = ""
  let programId = ""

  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_HYGIENE" })
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

  it("creates agents with and without a declared limit", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const silice = await service.createExposureAgent({
      code: "SIL", name: "Sílice cristalina respirable", agentType: "chemical", unit: "mg/m3",
      permissibleLimit: 0.08, actionLevelFactor: 0.5,
      limitBasis: "DS 594 art. 66, límite ponderado para sílice cristalina.",
      surveillanceProtocol: "Protocolo Sílice MINSAL",
    }, HYGIENIST)
    agentId = silice.id

    const psicosocial = await service.createExposureAgent({
      code: "PSI", name: "Riesgo psicosocial laboral", agentType: "psychosocial", unit: "índice",
      limitBasis: "Protocolo CEAL-SM: la evaluación no usa un límite ponderado numérico.",
    }, HYGIENIST)
    uncappedAgentId = psicosocial.id
    expect(psicosocial.permissibleLimit).toBeNull()
  })

  it("denies group creation from a foreign worksite scope", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    await expect(service.createExposureGroup({
      code: "GES-X", name: "Grupo ajeno", worksiteId: "ws-hy-a", agentId,
      processDescription: "Intento de crear un GES en una faena fuera del alcance.",
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  it("creates a GES and refuses members from another worksite", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const group = await service.createExposureGroup({
      code: "GES-SIL-01", name: "Operadores de clasificación", worksiteId: "ws-hy-a", agentId,
      processDescription: "Clasificación manual de residuos con generación de polvo respirable.",
    }, HYGIENIST)
    groupId = group.id
    expect(group.surveillanceRequired).toBe(false)

    await expect(service.addExposureGroupMember({
      groupId, workerId: "wk-b1", joinedOn: "2026-08-01",
    }, HYGIENIST)).rejects.toThrow(/otra/)

    for (const workerId of ["wk-a1", "wk-a2", "wk-a3", "wk-a4", "wk-a5", "wk-a6"]) {
      await service.addExposureGroupMember({ groupId, workerId, joinedOn: "2026-08-01" }, HYGIENIST)
    }
    const members = await getDb().select().from(schema.preventionExposureGroupMembers)
      .where(eq(schema.preventionExposureGroupMembers.groupId, groupId))
    expect(members).toHaveLength(6)
  })

  it("a measurement below the action level does not trigger surveillance", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const result = await service.recordExposureMeasurement({
      groupId, measuredOn: "2026-08-05", value: 0.02, method: "NIOSH 7500",
      equipmentTag: "BOMBA-01", calibrationDate: "2026-07-01", laboratoryName: "Lab externo",
    }, HYGIENIST)
    expect(result.assessment.outcome).toBe("below_action")
    expect(result.surveillanceRequired).toBe(false)
    // El límite y el nivel de acción quedan congelados en la fila.
    expect(result.measurement.permissibleLimitSnapshot).toBe("0.0800")
    expect(result.measurement.actionLevelSnapshot).toBe("0.0400")
  })

  it("a measurement over the limit puts the group under surveillance with a stated basis", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const result = await service.recordExposureMeasurement({
      groupId, measuredOn: "2026-09-05", value: 0.12, method: "NIOSH 7500", equipmentTag: "BOMBA-01",
    }, HYGIENIST)
    expect(result.assessment.outcome).toBe("above_limit")
    expect(result.surveillanceRequired).toBe(true)

    const [group] = await getDb().select().from(schema.preventionExposureGroups)
      .where(eq(schema.preventionExposureGroups.id, groupId))
    expect(group?.surveillanceRequired).toBe(true)
    expect(group?.surveillanceReason).toContain("2026-09-05")
  })

  it("an agent without a declared limit is not reported as compliant", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const group = await service.createExposureGroup({
      code: "GES-PSI-01", name: "Equipo administrativo", worksiteId: "ws-hy-a", agentId: uncappedAgentId,
      processDescription: "Evaluación de riesgo psicosocial del equipo administrativo de faena.",
    }, HYGIENIST)
    smallGroupId = group.id
    await service.addExposureGroupMember({ groupId: smallGroupId, workerId: "wk-a1", joinedOn: "2026-08-01" }, HYGIENIST)
    await service.addExposureGroupMember({ groupId: smallGroupId, workerId: "wk-a2", joinedOn: "2026-08-01" }, HYGIENIST)

    const result = await service.recordExposureMeasurement({
      groupId: smallGroupId, measuredOn: "2026-08-20", value: 75, method: "CEAL-SM", equipmentTag: "CUESTIONARIO",
    }, HYGIENIST)
    expect(result.assessment.outcome).toBe("not_comparable")
    expect(result.measurement.permissibleLimitSnapshot).toBeNull()
  })

  it("a later campaign below the action level releases surveillance but keeps the record of the excedence", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const result = await service.recordExposureMeasurement({
      groupId, measuredOn: "2026-12-05", value: 0.01, method: "NIOSH 7500", equipmentTag: "BOMBA-02",
    }, HYGIENIST)
    expect(result.surveillanceRequired).toBe(false)
    expect(result.basis).toContain("excedencias previas")

    const [group] = await getDb().select().from(schema.preventionExposureGroups)
      .where(eq(schema.preventionExposureGroups.id, groupId))
    expect(group?.surveillanceRequired).toBe(false)
  })

  it("enrolls the whole GES in a surveillance programme, deriving the roster from membership", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const program = await service.createSurveillanceProgram({
      code: "VIG-SIL", name: "Vigilancia por exposición a sílice", protocol: "Protocolo Sílice MINSAL",
      agentId, worksiteId: "ws-hy-a", periodicityMonths: 12,
      legalBasis: "DS 594 y protocolo de vigilancia de la exposición a sílice.",
    }, HYGIENIST)
    programId = program.id

    const result = await service.enrollGroupInSurveillance({
      programId, groupId, startingOn: "2026-09-10",
    }, HYGIENIST)
    expect(result).toMatchObject({ enrolled: 6, total: 6, dueOn: "2027-09-10" })

    // Reenrolar el mismo período no duplica la matrícula.
    const replay = await service.enrollGroupInSurveillance({ programId, groupId, startingOn: "2026-09-10" }, HYGIENIST)
    expect(replay.enrolled).toBe(0)
  })

  it("requires a date to record attendance and a reason to record an absence", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const [enrollment] = await getDb().select().from(schema.preventionSurveillanceEnrollments)
      .where(eq(schema.preventionSurveillanceEnrollments.programId, programId)).limit(1)

    await expect(service.recordSurveillanceOutcome({
      enrollmentId: enrollment!.id, status: "attended",
    }, HYGIENIST)).rejects.toThrow(/fecha del control/)

    await expect(service.recordSurveillanceOutcome({
      enrollmentId: enrollment!.id, status: "absent",
    }, HYGIENIST)).rejects.toThrow(/motivo/)
  })

  it("links the clinical result to the encrypted health record instead of storing it here", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const now = new Date().toISOString()
    await getDb().insert(schema.preventionHealthRecords).values({
      id: "hr-1", workerId: "wk-a1", worksiteId: "ws-hy-a", recordType: "vigilancia",
      status: "vigente", fitnessStatus: "apto", createdByUserId: "hy-manager",
      createdAt: now, updatedAt: now,
    })
    const [enrollment] = await getDb().select().from(schema.preventionSurveillanceEnrollments)
      .where(eq(schema.preventionSurveillanceEnrollments.workerId, "wk-a1")).limit(1)

    const updated = await service.recordSurveillanceOutcome({
      enrollmentId: enrollment!.id, status: "attended", attendedOn: "2026-10-01", healthRecordId: "hr-1",
    }, HYGIENIST)
    expect(updated).toMatchObject({ status: "attended", healthRecordId: "hr-1" })
    // La matrícula no guarda ningún dato clínico: sólo el enlace.
    expect(Object.keys(updated)).not.toContain("diagnosis")
  })

  it("publishes an anonymized summary and suppresses groups too small to publish", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const summary = await service.getAnonymizedExposureSummary(VIEWER)

    const big = summary.find((item) => item.groupId === groupId)
    expect(big).toMatchObject({ exposedCount: 6, suppressed: false })
    expect(big?.attendanceRate).not.toBeNull()

    // El grupo de dos personas se suprime: publicar su tasa permitiría
    // reidentificar a alguien y su vínculo con vigilancia, que es dato de salud.
    const small = summary.find((item) => item.groupId === smallGroupId)
    expect(small).toMatchObject({ exposedCount: 2, suppressed: true, attendanceRate: null })

    expect(JSON.stringify(summary)).not.toContain("wk-a1")
  })

  it("does not leak groups or programmes of another worksite", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    expect(await service.listExposureGroups(OUTSIDER)).toEqual([])
    expect(await service.listSurveillancePrograms(OUTSIDER)).toEqual([])
    expect(await service.getAnonymizedExposureSummary(OUTSIDER)).toEqual([])
    expect(await service.listGroupMeasurements(groupId, OUTSIDER)).toBeNull()
  })

  it("refuses to enroll a group from another worksite into the programme", async () => {
    const service = await import("@/lib/services/prevention-hygiene")
    const foreign = await getDb().insert(schema.preventionExposureGroups).values({
      id: "grp-foreign", code: "GES-B-01", name: "Grupo faena sur", worksiteId: "ws-hy-b",
      agentId, processDescription: "Grupo de otra faena para probar el cruce de alcance.",
      createdByUserId: "hy-manager",
    }).returning()
    await expect(service.enrollGroupInSurveillance({
      programId, groupId: foreign[0]!.id,
    }, HYGIENIST)).rejects.toThrow(/faenas distintas/)
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-hy-a", name: "Faena Norte", code: "HY-A", createdAt: now, updatedAt: now },
    { id: "ws-hy-b", name: "Faena Sur", code: "HY-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.workers).values([
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `wk-a${index + 1}`,
      rut: `1111111${index}-1`,
      firstName: `Persona${index + 1}`,
      lastName: "Expuesta",
      worksiteId: "ws-hy-a",
      createdAt: now,
    })),
    { id: "wk-b1", rut: "22222222-2", firstName: "Ajena", lastName: "Sur", worksiteId: "ws-hy-b", createdAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "hy-manager", name: "Higienista", email: "hy-manager@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "hy-viewer", name: "Lector", email: "hy-viewer@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "hy-outsider", name: "Ajeno", email: "hy-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1, onnotice: () => undefined })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
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

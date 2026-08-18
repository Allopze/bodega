/** Real PostgreSQL proof for canonical DS 44 indicators and closed-period correction. */
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

const databaseUrl = process.env.PREVENTION_INDICATORS_DATABASE_URL
const canResetDatabase = process.env.PREVENTION_INDICATORS_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined
const previousDatabaseUrl = process.env.DATABASE_URL

describeIf("canonical prevention indicators on real PostgreSQL", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canResetDatabase, context: "PREVENTION_INDICATORS" })
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

  it("derives the three golden rates, approves sources and closes an immutable snapshot", async () => {
    const incidents = await import("@/lib/services/prevention-incidents")
    const indicators = await import("@/lib/services/prevention-indicadores")
    const reportAccess = incidentAccess("indicator-preparer", ["prevention:incidents:report", "prevention:incidents:investigate"])
    const first = await reportWorkAccident(incidents, reportAccess, {
      clientSubmissionId: "indicator-golden-001", occurredAt: "2026-01-10T12:00:00.000Z", workerId: "indicator-worker-1", absenceDays: 5,
    })
    const second = await reportWorkAccident(incidents, reportAccess, {
      clientSubmissionId: "indicator-golden-002", occurredAt: "2026-01-20T12:00:00.000Z", workerId: "indicator-worker-2", absenceDays: 0, chargeDays: 6,
    })
    const [firstPerson] = await getDb().select().from(schema.preventionIncidentPeople).where(eq(schema.preventionIncidentPeople.incidentId, first.incident.id))
    const [secondPerson] = await getDb().select().from(schema.preventionIncidentPeople).where(eq(schema.preventionIncidentPeople.incidentId, second.incident.id))

    const preparer = indicatorAccess("indicator-preparer", ["prevention:indicadores:manage"])
    const pendingDenominator = await indicators.upsertSafetyIndicatorDenominator({
      worksiteId: "ws-indicators", year: 2026, month: 1, workerCount: 100, workedHours: 200_000,
      sourceType: "rrhh", sourceReference: "Nómina y control horario enero 2026", evidenceReference: "doc-rrhh-2026-01",
      reconciliationStatus: "matched", reconciliationNotes: null, submitForReview: true,
    }, preparer)
    await expect(indicators.approveSafetyIndicatorDenominator({
      denominatorId: pendingDenominator.id, expectedVersion: pendingDenominator.version, decision: "approved", reason: "Fuente cuadrada y evidencia revisada",
    }, indicatorAccess("indicator-preparer", ["prevention:indicadores:close"]))).rejects.toThrow(/no puede aprobarlo/i)
    const approved = await indicators.approveSafetyIndicatorDenominator({
      denominatorId: pendingDenominator.id, expectedVersion: pendingDenominator.version, decision: "approved", reason: "Fuente cuadrada con nómina y control horario",
    }, indicatorAccess("indicator-approver", ["prevention:indicadores:close"]))
    expect(approved.status).toBe("approved")

    let view = await indicators.getCanonicalSafetyIndicatorYear(2026, { mode: "some", ids: ["ws-indicators"] })
    const provisional = view.groups.find((item) => item.worksiteId === "ws-indicators")!.monthly[0]!
    expect(provisional).toMatchObject({ status: "provisional", pendingCaseCount: 2 })
    expect(provisional.confirmed.frequencyRate).toBe(0)
    expect(provisional.provisional).toMatchObject({ frequencyRate: 10, severityRate: 55, accidentabilityRate: 2 })
    await expect(indicators.closeSafetyIndicatorPeriod({ worksiteId: "ws-indicators", year: 2026, month: 1, reason: "Intento con casos aún pendientes" }, "indicator-approver", { mode: "some", ids: ["ws-indicators"] }))
      .rejects.toThrow(/no puede cerrarse/i)

    const classificationAccess = incidentAccess("indicator-preparer", ["prevention:incidents:investigate", "prevention:indicadores:close"])
    await incidents.classifyIncidentPersonForIndicators({ access: classificationAccess, input: {
      incidentId: first.incident.id, personId: firstPerson!.id, expectedIncidentVersion: first.incident.version,
      expectedPersonVersion: firstPerson!.version, absenceAtLeastNormalShift: true, absenceDays: 5, chargeDays: 0,
      administratorQualification: "Accidente del trabajo confirmado", inclusionStatus: "included", reason: "Resolución del organismo administrador revisada",
    } })
    await incidents.classifyIncidentPersonForIndicators({ access: classificationAccess, input: {
      incidentId: second.incident.id, personId: secondPerson!.id, expectedIncidentVersion: second.incident.version,
      expectedPersonVersion: secondPerson!.version, absenceAtLeastNormalShift: true, absenceDays: 1, chargeDays: 6,
      administratorQualification: "Accidente del trabajo confirmado", inclusionStatus: "included", reason: "Resolución del organismo administrador revisada",
    } })
    view = await indicators.getCanonicalSafetyIndicatorYear(2026, { mode: "some", ids: ["ws-indicators"] })
    const canonical = view.groups.find((item) => item.worksiteId === "ws-indicators")!.monthly[0]!
    expect(canonical.status).toBe("reconciled")
    expect(canonical.confirmed).toMatchObject({ frequencyRate: 10, severityRate: 60, accidentabilityRate: 2 })

    await getDb().insert(schema.safetyIndicators).values({
      id: "legacy-indicator-jan", worksiteId: "ws-indicators", year: 2026, month: 1,
      trabajadores: 90, horasHombre: 180_000, accConTiempoPerdido: 1, accSinTiempoPerdido: 0,
      diasPerdidos: 4, incidentes: 0, danoMaterial: 0, danoAmbiental: 0,
      updatedByUserId: "indicator-preparer", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    const closed = await indicators.closeSafetyIndicatorPeriod({
      worksiteId: "ws-indicators", year: 2026, month: 1, reason: "Fuentes canónicas conciliadas y casos calificados",
    }, "indicator-approver", { mode: "some", ids: ["ws-indicators"] })
    expect(closed.snapshot).toMatchObject({ status: "approved", formulaVersion: "ds44-art73-2026-v3", reconciliationStatus: "matched" })
    expect(closed.snapshot.sourceHashSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(closed.legacyComparison.status).toBe("difference")
    const [legacy] = await getDb().select().from(schema.safetyIndicators).where(eq(schema.safetyIndicators.id, "legacy-indicator-jan"))
    expect(legacy).toMatchObject({ provenanceStatus: "difference", reconciledSnapshotId: closed.snapshot.id })
  })

  it("requires privileged reason for a closed-period qualification change and preserves both snapshots", async () => {
    const incidents = await import("@/lib/services/prevention-incidents")
    const indicators = await import("@/lib/services/prevention-indicadores")
    const [originalSnapshot] = await getDb().select().from(schema.safetyIndicatorSnapshots).where(eq(schema.safetyIndicatorSnapshots.worksiteId, "ws-indicators"))
    const [incident] = await getDb().select().from(schema.preventionIncidents).where(eq(schema.preventionIncidents.clientSubmissionId, "indicator-golden-002"))
    const [person] = await getDb().select().from(schema.preventionIncidentPeople).where(eq(schema.preventionIncidentPeople.incidentId, incident!.id))
    await expect(incidents.classifyIncidentPersonForIndicators({
      access: incidentAccess("indicator-preparer", ["prevention:incidents:investigate"]),
      input: { incidentId: incident!.id, personId: person!.id, expectedIncidentVersion: incident!.version, expectedPersonVersion: person!.version, absenceAtLeastNormalShift: true, absenceDays: 1, chargeDays: 6, administratorQualification: "Origen común", inclusionStatus: "excluded", reason: "Cambio posterior de calificación del administrador" },
    })).rejects.toThrow(/permiso de cierre/i)
    const [stillClosed] = await getDb().select().from(schema.safetyIndicatorPeriods).where(eq(schema.safetyIndicatorPeriods.worksiteId, "ws-indicators"))
    expect(stillClosed?.status).toBe("closed")

    const corrected = await incidents.classifyIncidentPersonForIndicators({
      access: incidentAccess("indicator-approver", ["prevention:incidents:investigate", "prevention:indicadores:close"]),
      input: { incidentId: incident!.id, personId: person!.id, expectedIncidentVersion: incident!.version, expectedPersonVersion: person!.version, absenceAtLeastNormalShift: true, absenceDays: 1, chargeDays: 6, administratorQualification: "Origen común", inclusionStatus: "excluded", reason: "Cambio posterior de calificación del administrador" },
    })
    expect(corrected.person.indicatorInclusionStatus).toBe("excluded")
    const [reopened] = await getDb().select().from(schema.safetyIndicatorPeriods).where(eq(schema.safetyIndicatorPeriods.worksiteId, "ws-indicators"))
    expect(reopened).toMatchObject({ status: "reopened", reopenReason: "Cambio posterior de calificación del administrador" })
    const previousSnapshots = await getDb().select().from(schema.safetyIndicatorSnapshots).where(eq(schema.safetyIndicatorSnapshots.worksiteId, "ws-indicators"))
    expect(previousSnapshots.some((item) => item.status === "superseded")).toBe(true)

    const reclosed = await indicators.closeSafetyIndicatorPeriod({
      worksiteId: "ws-indicators", year: 2026, month: 1, reason: "Recálculo aprobado tras cambio de calificación",
    }, "indicator-approver", { mode: "some", ids: ["ws-indicators"] })
    expect(reclosed.result.confirmed).toMatchObject({ accidents: 1, injuredPeople: 1, frequencyRate: 5 })
    const snapshots = await getDb().select().from(schema.safetyIndicatorSnapshots).where(eq(schema.safetyIndicatorSnapshots.worksiteId, "ws-indicators"))
    expect(snapshots.filter((item) => item.status === "approved")).toHaveLength(1)
    expect(snapshots.filter((item) => item.status === "superseded")).toHaveLength(1)
    expect(new Set(snapshots.map((item) => item.sourceHashSha256)).size).toBe(2)
    // Un snapshot superseded conserva byte a byte la fórmula y el resultado con que se cerró
    // originalmente: cerrar de nuevo inserta una fila nueva, nunca reescribe la anterior. Esto es
    // lo que permite reconstruir qué versión de fórmula regía en cada cierre histórico.
    const supersededSnapshot = snapshots.find((item) => item.status === "superseded")!
    expect(supersededSnapshot.id).toBe(originalSnapshot!.id)
    expect(supersededSnapshot.formulaVersion).toBe(originalSnapshot!.formulaVersion)
    expect(supersededSnapshot.resultSnapshot).toEqual(originalSnapshot!.resultSnapshot)
    expect(supersededSnapshot.sourceHashSha256).toBe(originalSnapshot!.sourceHashSha256)
    const history = await getDb().select().from(schema.safetyIndicatorHistory).where(eq(schema.safetyIndicatorHistory.worksiteId, "ws-indicators"))
    expect(history.map((item) => item.changeType)).toEqual(expect.arrayContaining(["denominator_created", "denominator_approved", "closed", "corrected", "superseded"]))
  })

  it("rejects zero-hour closure and foreign-faena reads or writes", async () => {
    const incidents = await import("@/lib/services/prevention-incidents")
    const indicators = await import("@/lib/services/prevention-indicadores")
    const report = await reportWorkAccident(incidents, incidentAccess("indicator-preparer", ["prevention:incidents:report", "prevention:incidents:investigate"]), {
      clientSubmissionId: "indicator-zero-hours", occurredAt: "2026-02-10T12:00:00.000Z", workerId: "indicator-worker-1", absenceDays: 1,
    })
    const [person] = await getDb().select().from(schema.preventionIncidentPeople).where(eq(schema.preventionIncidentPeople.incidentId, report.incident.id))
    await incidents.classifyIncidentPersonForIndicators({ access: incidentAccess("indicator-preparer", ["prevention:incidents:investigate"]), input: {
      incidentId: report.incident.id, personId: person!.id, expectedIncidentVersion: report.incident.version, expectedPersonVersion: person!.version,
      absenceAtLeastNormalShift: true, absenceDays: 1, chargeDays: 0, administratorQualification: "Accidente confirmado", inclusionStatus: "included", reason: "Resolución revisada para el caso de cero horas",
    } })
    const draft = await indicators.upsertSafetyIndicatorDenominator({
      worksiteId: "ws-indicators", year: 2026, month: 2, workerCount: 100, workedHours: 0,
      sourceType: "rrhh", sourceReference: "Fuente febrero", evidenceReference: "doc-febrero",
      reconciliationStatus: "matched", submitForReview: true,
    }, indicatorAccess("indicator-preparer", ["prevention:indicadores:manage"]))
    await indicators.approveSafetyIndicatorDenominator({ denominatorId: draft.id, expectedVersion: draft.version, decision: "approved", reason: "Fuente revisada aunque reporta cero horas" }, indicatorAccess("indicator-approver", ["prevention:indicadores:close"]))
    await expect(indicators.closeSafetyIndicatorPeriod({ worksiteId: "ws-indicators", year: 2026, month: 2, reason: "Intento de cierre con numerador y cero horas" }, "indicator-approver", { mode: "some", ids: ["ws-indicators"] }))
      .rejects.toThrow(/sin horas/i)

    await expect(indicators.upsertSafetyIndicatorDenominator({
      worksiteId: "ws-indicators", year: 2026, month: 3, workerCount: 10, workedHours: 100,
      sourceType: "manual", sourceReference: "Intento ajeno", evidenceReference: "doc-ajeno", reconciliationStatus: "matched",
    }, indicatorAccess("indicator-outsider", ["prevention:indicadores:manage"], ["ws-foreign"]))).rejects.toThrow(/fuera de alcance/i)
    const foreignView = await indicators.getCanonicalSafetyIndicatorYear(2026, { mode: "some", ids: ["ws-foreign"] })
    expect(foreignView.groups.some((item) => item.worksiteId === "ws-indicators")).toBe(false)
  })
})

function indicatorAccess(userId: string, permissions: string[], scopeIds: string[] = ["ws-indicators"]) {
  return { userId, scope: { mode: "some" as const, ids: scopeIds }, permissions }
}

function incidentAccess(userId: string, permissions: string[]) {
  return { ctx: { userId }, scope: { mode: "some" as const, ids: ["ws-indicators"] }, permissions }
}

async function reportWorkAccident(
  incidents: typeof import("@/lib/services/prevention-incidents"),
  access: ReturnType<typeof incidentAccess>,
  input: { clientSubmissionId: string; occurredAt: string; workerId: string; absenceDays: number; chargeDays?: number },
) {
  return incidents.reportPreventionIncident({ access, input: {
    clientSubmissionId: input.clientSubmissionId,
    worksiteId: "ws-indicators", companyName: "Chome", eventType: "work_accident",
    occurredAt: input.occurredAt, knownAt: input.occurredAt, location: "Planta",
    initialNarrative: "Accidente del trabajo de prueba para validar el motor de indicadores canónicos.",
    actualSeverity: "lost_time", potentialSeverity: "medium", immediateMeasures: "Atención inicial y control del área.",
    people: [{
      workerId: input.workerId, displayLabel: `Persona ${input.workerId}`, employerName: "Chome", relationshipType: "employee",
      sex: input.workerId.endsWith("1") ? "female" : "male", absenceAtLeastNormalShift: true,
      absenceDays: input.absenceDays, chargeDays: input.chargeDays ?? 0,
    }],
  } })
}

function getDb() {
  if (!testDb) throw new Error("Indicator test database was not initialized")
  return testDb
}

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-indicators", name: "Faena Indicadores", code: "IND", createdAt: now, updatedAt: now },
    { id: "ws-foreign", name: "Faena Ajena", code: "IND-FGN", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.workers).values([
    { id: "indicator-worker-1", rut: "12.111.111-1", firstName: "Persona", lastName: "Uno", worksiteId: "ws-indicators", createdAt: now },
    { id: "indicator-worker-2", rut: "12.222.222-2", firstName: "Persona", lastName: "Dos", worksiteId: "ws-indicators", createdAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "indicator-preparer", name: "Preparador", email: "indicator-preparer@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "indicator-approver", name: "Aprobador", email: "indicator-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "indicator-outsider", name: "Ajeno", email: "indicator-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
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
  } finally {
    await setupClient.end()
  }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1, onnotice: () => undefined })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1`
    if (rows.length === 0) await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
  } finally {
    await maintenanceClient.end()
  }
}

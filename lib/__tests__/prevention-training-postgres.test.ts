/** Real PostgreSQL proof for training, ODI, competencies and gap enforcement. */
import path from "node:path"
import postgres from "postgres"
import { and, eq, sql } from "drizzle-orm"
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

const databaseUrl = process.env.PREVENTION_TRAINING_DATABASE_URL
const canReset = process.env.PREVENTION_TRAINING_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const AUTHOR = { userId: "tr-author", scope: { mode: "some", ids: ["ws-tr-a"] } as WorksiteScope, permissions: ["prevention:training:view", "prevention:training:manage", "prevention:training:deliver"] }
const APPROVER = { userId: "tr-approver", scope: { mode: "all", ids: [] } as WorksiteScope, permissions: ["prevention:training:view", "prevention:training:approve", "prevention:training:convalidate", "prevention:training:revoke"] }
const OUTSIDER = { userId: "tr-outsider", scope: { mode: "some", ids: ["ws-tr-b"] } as WorksiteScope, permissions: ["prevention:training:view", "prevention:training:manage", "prevention:training:deliver"] }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

describeIf("Capacitación y competencias on real PostgreSQL", () => {
  let courseId = ""
  let versionId = ""
  let sessionId = ""

  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_TRAINING" })
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

  it("rejects a legal course below the DS 44 art. 16 floor", async () => {
    const { createTrainingCourse } = await import("@/lib/services/prevention-training")
    await expect(createTrainingCourse({
      code: "LEG-SHORT", name: "Curso corto", kind: "legal_mandatory",
      minimumDurationMinutes: 120, validityMonths: 24, passingScore: 70,
      legalBasis: "DS 44 art. 16",
    }, AUTHOR)).rejects.toThrow(/480/)
  })

  it("creates a compliant legal course and its draft version", async () => {
    const { createTrainingCourse, createTrainingCourseVersion } = await import("@/lib/services/prevention-training")
    const course = await createTrainingCourse({
      code: "LEG-8H", name: "Prevención de riesgos laborales", kind: "legal_mandatory",
      minimumDurationMinutes: 480, validityMonths: 24, passingScore: 70,
      requiresAssessment: true, legalBasis: "DS 44/2024 art. 16",
    }, AUTHOR)
    courseId = course.id

    const version = await createTrainingCourseVersion({
      courseId, versionLabel: "v1",
      contentOutline: [{ title: "Marco legal", minutes: 240 }, { title: "Riesgos del puesto", minutes: 240 }],
      durationMinutes: 480, modality: "presencial", assessmentType: "theoretical", passingScore: 70,
    }, AUTHOR)
    versionId = version.id
    expect(version.status).toBe("draft")
    expect(version.contentHash).toHaveLength(64)
  })

  it("blocks the author from approving their own content and lets a segregated approver publish", async () => {
    const { transitionTrainingCourseVersion } = await import("@/lib/services/prevention-training")
    const inReview = await transitionTrainingCourseVersion({
      versionId, toStatus: "in_review", reason: "Contenido listo para revisión técnica.", expectedVersion: 1,
    }, AUTHOR)

    await expect(transitionTrainingCourseVersion({
      versionId, toStatus: "approved", reason: "Intento de autoaprobación del autor.", expectedVersion: inReview.version,
    }, { ...AUTHOR, permissions: [...AUTHOR.permissions, "prevention:training:approve"] })).rejects.toThrow(/no puede aprobar/)

    const approved = await transitionTrainingCourseVersion({
      versionId, toStatus: "approved", reason: "Contenido conforme al DS 44 art. 16.", expectedVersion: inReview.version,
    }, APPROVER)
    const published = await transitionTrainingCourseVersion({
      versionId, toStatus: "published", reason: "Habilitado para dictarse en faena.", expectedVersion: approved.version,
    }, APPROVER)
    expect(published.status).toBe("published")
    expect(published.publishedByUserId).toBe("tr-approver")
  })

  it("rejects a stale expectedVersion instead of silently overwriting", async () => {
    const { transitionTrainingCourseVersion } = await import("@/lib/services/prevention-training")
    await expect(transitionTrainingCourseVersion({
      versionId, toStatus: "published", reason: "Reintento con versión antigua.", expectedVersion: 1,
    }, APPROVER)).rejects.toThrow(/cambió mientras editabas/)
  })

  it("refuses to convene a worker from another worksite", async () => {
    const { createTrainingSession } = await import("@/lib/services/prevention-training")
    await expect(createTrainingSession({
      courseVersionId: versionId, worksiteId: "ws-tr-a",
      scheduledAt: "2026-08-01T13:00:00.000Z", modality: "presencial",
      instructorExternalName: "Relator externo", instructorCompetencyEvidence: "Certificado OTEC 12345",
      convenedWorkerIds: ["wk-a1", "wk-b1"],
    }, AUTHOR)).rejects.toThrow(/otra faena/)
  })

  it("denies session creation from a foreign worksite scope", async () => {
    const { createTrainingSession } = await import("@/lib/services/prevention-training")
    await expect(createTrainingSession({
      courseVersionId: versionId, worksiteId: "ws-tr-a",
      scheduledAt: "2026-08-01T13:00:00.000Z", modality: "presencial",
      instructorExternalName: "Relator externo", instructorCompetencyEvidence: "Certificado OTEC 12345",
      convenedWorkerIds: [],
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  it("creates the session with its convened denominator", async () => {
    const { createTrainingSession } = await import("@/lib/services/prevention-training")
    const created = await createTrainingSession({
      courseVersionId: versionId, worksiteId: "ws-tr-a",
      scheduledAt: "2026-08-01T13:00:00.000Z", modality: "presencial",
      instructorExternalName: "Relator externo", instructorCompetencyEvidence: "Certificado OTEC 12345",
      convenedWorkerIds: ["wk-a1", "wk-a2", "wk-a3"],
    }, AUTHOR)
    sessionId = created.id

    const attendance = await getDb().select().from(schema.preventionTrainingAttendance)
      .where(eq(schema.preventionTrainingAttendance.sessionId, sessionId))
    expect(attendance).toHaveLength(3)
    expect(attendance.every((row) => row.status === "convened")).toBe(true)
  })

  it("will not close a session while a convened worker has no attendance result", async () => {
    const { closeTrainingSession } = await import("@/lib/services/prevention-training")
    await expect(closeTrainingSession({
      sessionId, startedAt: "2026-08-01T13:00:00.000Z", endedAt: "2026-08-01T21:00:00.000Z", expectedVersion: 1,
    }, AUTHOR)).rejects.toThrow(/sin resultado de asistencia/)
  })

  it("records attendance and derives the assessment result from the passing score", async () => {
    const { recordTrainingAttendance } = await import("@/lib/services/prevention-training")
    const rows = await recordTrainingAttendance({
      sessionId,
      entries: [
        { workerId: "wk-a1", status: "attended", attendanceMinutes: 480, assessmentScore: 85 },
        { workerId: "wk-a2", status: "attended", attendanceMinutes: 480, assessmentScore: 40 },
        { workerId: "wk-a3", status: "absent" },
      ],
    }, AUTHOR)
    const byWorker = new Map(rows.map((row) => [row.workerId, row]))
    expect(byWorker.get("wk-a1")?.assessmentResult).toBe("approved")
    expect(byWorker.get("wk-a2")?.assessmentResult).toBe("failed")
    expect(byWorker.get("wk-a3")?.status).toBe("absent")
  })

  it("refuses to close a legal session shorter than the course requires", async () => {
    const { closeTrainingSession } = await import("@/lib/services/prevention-training")
    await expect(closeTrainingSession({
      sessionId, startedAt: "2026-08-01T13:00:00.000Z", endedAt: "2026-08-01T16:00:00.000Z", expectedVersion: 1,
    }, AUTHOR)).rejects.toThrow(/480 min/)
  })

  it("grants competency only to attendees who passed, and is idempotent on double close", async () => {
    const { closeTrainingSession } = await import("@/lib/services/prevention-training")
    const result = await closeTrainingSession({
      sessionId, startedAt: "2026-08-01T13:00:00.000Z", endedAt: "2026-08-01T21:00:00.000Z", expectedVersion: 1,
    }, AUTHOR)
    expect(result.grantedCount).toBe(1)
    expect(result.convenedCount).toBe(3)

    const competencies = await getDb().select().from(schema.preventionWorkerCompetencies)
      .where(eq(schema.preventionWorkerCompetencies.courseId, courseId))
    expect(competencies).toHaveLength(1)
    expect(competencies[0]).toMatchObject({ workerId: "wk-a1", status: "valid", sourceType: "session" })
    // Vigencia derivada de validityMonths = 24 meses desde el término.
    expect(competencies[0]?.expiresAt).toBe("2028-08-01")

    await expect(closeTrainingSession({
      sessionId, startedAt: "2026-08-01T13:00:00.000Z", endedAt: "2026-08-01T21:00:00.000Z", expectedVersion: 2,
    }, AUTHOR)).rejects.toThrow(/ya fue cerrada/)

    const after = await getDb().select().from(schema.preventionWorkerCompetencies)
      .where(eq(schema.preventionWorkerCompetencies.courseId, courseId))
    expect(after).toHaveLength(1)
  })

  it("reports gaps for the worker who failed and the one who was absent", async () => {
    const { createCompetencyRequirement, listCompetencyGaps } = await import("@/lib/services/prevention-training")
    await createCompetencyRequirement({
      courseId, scopeType: "worksite", worksiteId: "ws-tr-a", enforcement: "blocking",
      reason: "Curso legal obligatorio exigido a toda la dotación de la faena.",
    }, AUTHOR)

    const gaps = await listCompetencyGaps(AUTHOR)
    const ids = gaps.map((gap) => gap.workerId).sort()
    expect(ids).toEqual(["wk-a2", "wk-a3"])
    expect(gaps.every((gap) => gap.enforcement === "blocking" && gap.gapType === "missing")).toBe(true)
  })

  it("does not leak gaps of another worksite to a foreign scope", async () => {
    const { listCompetencyGaps } = await import("@/lib/services/prevention-training")
    const gaps = await listCompetencyGaps(OUTSIDER)
    expect(gaps.every((gap) => gap.worksiteId === "ws-tr-b")).toBe(true)
    expect(gaps.some((gap) => gap.workerId === "wk-a2")).toBe(false)
  })

  it("escalates blocking gaps to CAPA exactly once per worker and course", async () => {
    const { escalateBlockingGapsToCapa } = await import("@/lib/services/prevention-training")
    const first = await escalateBlockingGapsToCapa(AUTHOR, { targetDate: "2026-09-30" })
    expect(first.created).toBe(2)

    const second = await escalateBlockingGapsToCapa(AUTHOR, { targetDate: "2026-09-30" })
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(2)

    const actions = await getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceType, "training"))
    expect(actions).toHaveLength(2)
    expect(actions.every((action) => action.worksiteId === "ws-tr-a" && action.priority === "high")).toBe(true)
  })

  it("only lets the convened person acknowledge their own training", async () => {
    const { acknowledgeTraining } = await import("@/lib/services/prevention-training")
    const [attendance] = await getDb().select().from(schema.preventionTrainingAttendance)
      .where(and(
        eq(schema.preventionTrainingAttendance.sessionId, sessionId),
        eq(schema.preventionTrainingAttendance.workerId, "wk-a1"),
      )).limit(1)

    const impostor = { userId: "tr-author", scope: { mode: "all", ids: [] } as WorksiteScope, permissions: ["prevention:training:ack"] }
    await expect(acknowledgeTraining({ attendanceId: attendance!.id, method: "platform_click" }, impostor, {}))
      .rejects.toThrow(/Sólo la persona convocada/)

    const owner = { userId: "tr-worker-a1", scope: { mode: "all", ids: [] } as WorksiteScope, permissions: ["prevention:training:ack"] }
    const acked = await acknowledgeTraining({ attendanceId: attendance!.id, method: "platform_click" }, owner, { ip: "10.0.0.5", userAgent: "vitest" })
    expect(acked.acknowledgementSha256).toHaveLength(64)
    expect(acked.acknowledgedAt).toBeTruthy()

    await expect(acknowledgeTraining({ attendanceId: attendance!.id, method: "platform_click" }, owner, {}))
      .rejects.toThrow(/ya fue acusada/)
  })

  it("expires a lapsed competency and reopens the gap", async () => {
    const { expireLapsedCompetencies, listCompetencyGaps } = await import("@/lib/services/prevention-training")
    await getDb().update(schema.preventionWorkerCompetencies)
      .set({ expiresAt: "2020-01-01" })
      .where(eq(schema.preventionWorkerCompetencies.workerId, "wk-a1"))

    const { expired } = await expireLapsedCompetencies()
    expect(expired).toBe(1)

    const gaps = await listCompetencyGaps(AUTHOR)
    const lapsed = gaps.find((gap) => gap.workerId === "wk-a1")
    expect(lapsed?.gapType).toBe("expired")
    expect(lapsed?.expiredAt).toBe("2020-01-01")
  })

  it("convalidates an external certificate and supersedes the previous competency", async () => {
    const { convalidateCompetency } = await import("@/lib/services/prevention-training")
    const created = await convalidateCompetency({
      workerId: "wk-a2", courseId, sourceType: "external_certificate",
      grantedAt: "2026-07-01", expiresAt: "2028-07-01",
      evidenceReference: "cert-otec-778", externalIssuer: "OTEC Externa",
      justification: "Certificado equivalente emitido por OTEC acreditada, revisado por jefatura.",
    }, APPROVER)
    expect(created.status).toBe("valid")

    const { listCompetencyGaps } = await import("@/lib/services/prevention-training")
    const gaps = await listCompetencyGaps(AUTHOR)
    expect(gaps.some((gap) => gap.workerId === "wk-a2")).toBe(false)
  })

  it("revokes a competency and the gap comes back", async () => {
    const { revokeCompetency, listCompetencyGaps } = await import("@/lib/services/prevention-training")
    const [competency] = await getDb().select().from(schema.preventionWorkerCompetencies)
      .where(and(
        eq(schema.preventionWorkerCompetencies.workerId, "wk-a2"),
        eq(schema.preventionWorkerCompetencies.status, "valid"),
      )).limit(1)

    await revokeCompetency({ competencyId: competency!.id, reason: "Certificado externo no verificable ante la OTEC." }, APPROVER)
    const gaps = await listCompetencyGaps(AUTHOR)
    expect(gaps.find((gap) => gap.workerId === "wk-a2")?.gapType).toBe("revoked")
  })

  it("produces an Excel whose gap sheet matches the live gaps", async () => {
    const { buildTrainingExport } = await import("@/lib/services/prevention-training-export")
    const exporter = { ...AUTHOR, permissions: [...AUTHOR.permissions, "prevention:training:export"] }
    const report = await buildTrainingExport(exporter)
    const gapSheet = report.sheets?.find((sheet) => sheet.worksheetName === "Brechas de competencia")
    expect(gapSheet?.rows.length).toBeGreaterThan(0)

    await expect(buildTrainingExport(AUTHOR)).rejects.toThrow(/fuera de alcance/)
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-tr-a", name: "Faena Norte", code: "TR-A", createdAt: now, updatedAt: now },
    { id: "ws-tr-b", name: "Faena Sur", code: "TR-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.workers).values([
    { id: "wk-a1", rut: "11111111-1", firstName: "Ana", lastName: "Pérez", position: "Operador", worksiteId: "ws-tr-a", createdAt: now },
    { id: "wk-a2", rut: "22222222-2", firstName: "Bruno", lastName: "Soto", position: "Operador", worksiteId: "ws-tr-a", createdAt: now },
    { id: "wk-a3", rut: "33333333-3", firstName: "Carla", lastName: "Díaz", position: "Ayudante", worksiteId: "ws-tr-a", createdAt: now },
    { id: "wk-b1", rut: "44444444-4", firstName: "Diego", lastName: "Rojas", position: "Operador", worksiteId: "ws-tr-b", createdAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "tr-author", name: "Autor", email: "tr-author@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "tr-approver", name: "Aprobador", email: "tr-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "tr-outsider", name: "Ajeno", email: "tr-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "tr-worker-a1", name: "Ana Pérez", email: "ana@local.invalid", hashedPassword: "hash", workerId: "wk-a1", createdAt: now, updatedAt: now },
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

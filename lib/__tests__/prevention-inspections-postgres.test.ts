/** Real PostgreSQL proof for the cross-cutting inspection engine. */
import path from "node:path"
import postgres from "postgres"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import type { InspectionItemSpec } from "@/lib/prevention/inspections"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PREVENTION_INSPECTIONS_DATABASE_URL
const canReset = process.env.PREVENTION_INSPECTIONS_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const scopeA = { mode: "some", ids: ["ws-in-a"] } as WorksiteScope
const ALL = [
  "prevention:inspections:view", "prevention:inspections:manage", "prevention:inspections:approve",
  "prevention:inspections:execute", "prevention:inspections:review",
]
const AUTHOR = { userId: "in-author", scope: scopeA, permissions: ["prevention:inspections:view", "prevention:inspections:manage", "prevention:inspections:execute"] }
const APPROVER = { userId: "in-approver", scope: scopeA, permissions: ALL }
const REVIEWER = { userId: "in-reviewer", scope: scopeA, permissions: ["prevention:inspections:view", "prevention:inspections:review"] }
const OUTSIDER = { userId: "in-outsider", scope: { mode: "some", ids: ["ws-in-b"] } as WorksiteScope, permissions: ALL }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

describeIf("Motor de inspecciones on real PostgreSQL", () => {
  let templateId = ""
  let templateVersion = 1
  let runId = ""
  let runVersion = 1
  let itemsCache: InspectionItemSpec[] = []

  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_INSPECTIONS" })
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

  it("refuses to import a person-evaluation definition into the inspection engine", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    await expect(service.importInspectionTemplate({ definitionCode: "trabajador_nuevo" }, AUTHOR))
      .rejects.toThrow(/evaluaciones de personas/i)
  })

  it("exposes the latent SST inspection definitions as importable", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const available = service.listImportableDefinitions()
    expect(available.length).toBeGreaterThan(0)
    expect(available.map((item) => item.code)).not.toContain("trabajador_nuevo")
    expect(available.every((item) => item.items > 0)).toBe(true)
  })

  it("imports an existing SST definition and freezes its content hash", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await service.importInspectionTemplate({ definitionCode: "inspeccion_extintores" }, AUTHOR)
    templateId = template.id
    templateVersion = template.version
    expect(template).toMatchObject({ status: "draft", sourceDefinitionCode: "inspeccion_extintores" })
    expect(template.contentHash).toHaveLength(64)
  })

  it("blocks the importer from approving their own template", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    await expect(service.approveInspectionTemplate({
      templateId, expectedVersion: templateVersion, reason: "Intento de autoaprobación de la plantilla.",
    }, { ...AUTHOR, permissions: [...AUTHOR.permissions, "prevention:inspections:approve"] }))
      .rejects.toThrow(/no puede aprobarla/)

    const approved = await service.approveInspectionTemplate({
      templateId, expectedVersion: templateVersion, reason: "Contenido revisado y conforme al estándar de la faena.",
    }, APPROVER)
    templateVersion = approved.version
    expect(approved).toMatchObject({ status: "approved", approvedByUserId: "in-approver" })
  })

  it("refuses to run a template that is not approved", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const draft = await service.importInspectionTemplate({ definitionCode: "inspeccion_taller" }, AUTHOR)
    await expect(service.createInspectionRun({
      templateId: draft.id, worksiteId: "ws-in-a",
    }, AUTHOR)).rejects.toThrow(/plantilla aprobada/)
  })

  it("denies run creation from a foreign worksite scope", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    await expect(service.createInspectionRun({ templateId, worksiteId: "ws-in-a" }, OUTSIDER))
      .rejects.toThrow(/fuera de alcance/)
  })

  it("creates the run idempotently for an offline resubmission", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const first = await service.createInspectionRun({
      templateId, worksiteId: "ws-in-a", subjectLabel: "Extintor PQS-14",
      clientSubmissionId: "offline-inspection-001",
    }, AUTHOR)
    const second = await service.createInspectionRun({
      templateId, worksiteId: "ws-in-a", subjectLabel: "Extintor PQS-14",
      clientSubmissionId: "offline-inspection-001",
    }, AUTHOR)
    runId = first.run.id
    runVersion = first.run.version
    expect(first.idempotentReplay).toBe(false)
    expect(second).toMatchObject({ idempotentReplay: true, run: { id: runId } })
    expect(await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.clientSubmissionId, "offline-inspection-001"))).toHaveLength(1)
  })

  it("rejects an answer that does not belong to the template", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    await expect(service.saveInspectionAnswers({
      runId, answers: [{ sectionId: "seccion-inexistente", itemId: "item-fantasma", result: "conforming" }],
    }, AUTHOR)).rejects.toThrow(/no corresponde a ningún ítem/)
  })

  it("will not complete the run while scored items are unanswered", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const [template] = await getDb().select().from(schema.preventionInspectionTemplates)
      .where(eq(schema.preventionInspectionTemplates.id, templateId))
    itemsCache = service.itemsFromDefinition(template!.definitionSnapshot as never)
    expect(itemsCache.length).toBeGreaterThan(1)

    // El catálogo SST heredado no declara `required` en ningún ítem; el piso de
    // seguridad exige entonces todo lo que cuenta para cumplimiento.
    expect(itemsCache.some((item) => item.required)).toBe(false)

    await service.saveInspectionAnswers({
      runId, answers: [{ sectionId: itemsCache[0]!.sectionId, itemId: itemsCache[0]!.itemId, result: "conforming" }],
    }, AUTHOR)

    const [current] = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, runId))
    await expect(service.completeInspectionRun({ runId, expectedVersion: current!.version }, AUTHOR))
      .rejects.toThrow(/No se puede declarar ejecutada/)
  })

  it("requires a reason to mark an item as not applicable", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const target = itemsCache[0]!
    await expect(service.saveInspectionAnswers({
      runId, answers: [{ sectionId: target.sectionId, itemId: target.itemId, result: "not_applicable", comment: "" }],
    }, AUTHOR)).rejects.toThrow()

    await service.saveInspectionAnswers({
      runId, answers: [{ sectionId: target.sectionId, itemId: target.itemId, result: "not_applicable", comment: "Extintor retirado de servicio." }],
    }, AUTHOR)
    const [stored] = await getDb().select().from(schema.preventionInspectionAnswers)
      .where(eq(schema.preventionInspectionAnswers.runId, runId))
    expect(stored).toMatchObject({ result: "not_applicable" })
  })

  it("completes the run, computes compliance and materializes findings by criticality", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const answers = itemsCache.map((item, index) => ({
      sectionId: item.sectionId,
      itemId: item.itemId,
      // Un incumplimiento deliberado en el primer ítem con daño potencial alto.
      result: index === 0 ? "non_conforming" as const : "conforming" as const,
      comment: index === 0 ? "Manómetro en zona roja" : null,
    }))
    await service.saveInspectionAnswers({ runId, answers }, AUTHOR)

    const [before] = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, runId))
    const result = await service.completeInspectionRun({ runId, expectedVersion: before!.version }, AUTHOR)
    runVersion = result.run.version

    expect(result.run.status).toBe("completed")
    expect(result.run.nonConformingCount).toBe(1)
    expect(result.compliancePercent).not.toBeNull()

    const findings = await getDb().select().from(schema.preventionInspectionFindings)
      .where(eq(schema.preventionInspectionFindings.runId, runId))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.description).toContain("Manómetro en zona roja")
    expect(findings[0]?.status).toBe("open")
    // Sin `danoPotencial` en el catálogo, la criticidad cae al default medio.
    expect(findings[0]?.criticality).toBe("medium")
  })

  it("blocks the executor from reviewing their own inspection", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    await expect(service.reviewInspectionRun({
      runId, expectedVersion: runVersion, reviewComment: "Intento de cerrar la propia inspección ejecutada.",
    }, { ...AUTHOR, permissions: [...AUTHOR.permissions, "prevention:inspections:review"] }))
      .rejects.toThrow(/no puede revisarla/)
  })

  it("blocks closure while a high or critical finding has no CAPA", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const [finding] = await getDb().select().from(schema.preventionInspectionFindings)
      .where(eq(schema.preventionInspectionFindings.runId, runId))

    // Se eleva la criticidad para ejercitar el gate: un hallazgo grave sin
    // acción no debe permitir cerrar la inspección.
    await getDb().update(schema.preventionInspectionFindings)
      .set({ criticality: "critical" })
      .where(eq(schema.preventionInspectionFindings.id, finding!.id))
    await expect(service.reviewInspectionRun({
      runId, expectedVersion: runVersion, reviewComment: "Intento de cierre con hallazgo grave sin acción.",
    }, REVIEWER)).rejects.toThrow(/no tiene CAPA/)

    const linked = await service.createFindingCapa({
      findingId: finding!.id,
      actionDescription: "Recargar y certificar el extintor, y verificar el resto del sector.",
      immediateMeasure: "Extintor retirado de servicio y reemplazado por uno operativo.",
    }, AUTHOR)
    expect(linked).toMatchObject({ status: "capa_linked" })
    expect(linked.capaActionId).toBeTruthy()

    const capa = await getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceType, "inspection"))
    expect(capa).toHaveLength(1)
    expect(capa[0]).toMatchObject({ sourceId: runId, worksiteId: "ws-in-a" })

    await expect(service.createFindingCapa({
      findingId: finding!.id, actionDescription: "Intento de duplicar la acción del mismo hallazgo.",
    }, AUTHOR)).rejects.toThrow(/ya tiene una acción CAPA/)
  })

  it("closes the inspection with an independent reviewer once findings have CAPA", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const reviewed = await service.reviewInspectionRun({
      runId, expectedVersion: runVersion,
      reviewComment: "Hallazgo con acción asignada y evidencia comprometida; se cierra la inspección.",
    }, REVIEWER)
    expect(reviewed).toMatchObject({ status: "reviewed", reviewedByUserId: "in-reviewer" })

    await expect(service.saveInspectionAnswers({
      runId, answers: [{ sectionId: itemsCache[0]!.sectionId, itemId: itemsCache[0]!.itemId, result: "conforming" }],
    }, AUTHOR)).rejects.toThrow(/cerrada o cancelada/)
  })

  it("reschedules the program from the actual execution date", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const program = await service.createInspectionProgram({
      templateId, worksiteId: "ws-in-a", frequency: "monthly", startsOn: "2026-08-01",
    }, AUTHOR)
    expect(program).toMatchObject({ intervalDays: 30, nextDueOn: "2026-08-01" })

    const created = await service.createInspectionRun({
      templateId, worksiteId: "ws-in-a", programId: program.id,
    }, AUTHOR)
    await service.saveInspectionAnswers({
      runId: created.run.id,
      answers: itemsCache.map((item) => ({ sectionId: item.sectionId, itemId: item.itemId, result: "conforming" as const })),
    }, AUTHOR)
    await service.completeInspectionRun({ runId: created.run.id, expectedVersion: created.run.version }, AUTHOR)

    const [after] = await getDb().select().from(schema.preventionInspectionPrograms)
      .where(eq(schema.preventionInspectionPrograms.id, program.id))
    expect(after!.nextDueOn > "2026-08-01").toBe(true)
  })

  it("does not leak runs of another worksite", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    expect(await service.listInspectionRuns(OUTSIDER)).toEqual([])
    expect(await service.getInspectionRunDetail(runId, OUTSIDER)).toBeNull()
  })

  // H-04 (AUDITORIA_BUGS_2026-08-05.md): el motor transversal recupera la
  // escala B/R/M ("Regular" = 'partial') que antes se perdía al aplanar la
  // definición. El template de extintores (arriba) es cumple/no-cumple puro:
  // sirve para probar el rechazo. inspeccion_carros es 100% B/R/M: prueba el
  // camino feliz end-to-end.
  it("rejects 'partial' on an item whose scale does not support it", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const { fieldKindAcceptsPartial } = await import("@/lib/prevention/inspections")
    // Run propio, no el `runId` compartido: para este punto de la suite ya
    // quedó "reviewed" (cerrado) por los tests de revisión de más abajo.
    const created = await service.createInspectionRun({ templateId, worksiteId: "ws-in-a" }, AUTHOR)
    // El template de extintores es cumple/no-cumple puro (§80-92): ningún
    // ítem admite 'partial'.
    const target = itemsCache.find((item) => !fieldKindAcceptsPartial(item.kind))!
    expect(target).toBeDefined()
    await expect(service.saveInspectionAnswers({
      runId: created.run.id, answers: [{ sectionId: target.sectionId, itemId: target.itemId, result: "partial", comment: "Desgaste menor." }],
    }, AUTHOR)).rejects.toThrow(/no admite la respuesta "Regular"/)
  })

  it("persists 'partial' end-to-end on a B/R/M template and scores it at 0.5", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await service.importInspectionTemplate({ definitionCode: "inspeccion_carros" }, AUTHOR)
    const approved = await service.approveInspectionTemplate({
      templateId: template.id, expectedVersion: template.version,
      reason: "Contenido revisado y conforme al estándar de la faena.",
    }, APPROVER)

    const created = await service.createInspectionRun({
      templateId: approved.id, worksiteId: "ws-in-a", subjectLabel: "Carro CR-04",
    }, AUTHOR)
    const brmItems = service.itemsFromDefinition(approved.definitionSnapshot as never)
    expect(brmItems.length).toBeGreaterThanOrEqual(3)

    // 1 Bueno, 1 Regular, resto Bueno: exactamente el caso que antes de H-04
    // el motor no podía siquiera registrar.
    const answers = brmItems.map((item, index) => ({
      sectionId: item.sectionId,
      itemId: item.itemId,
      result: index === 1 ? "partial" as const : "conforming" as const,
      comment: index === 1 ? "Desgaste menor, aún operativo." : null,
    }))
    await service.saveInspectionAnswers({ runId: created.run.id, answers }, AUTHOR)

    const [before] = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, created.run.id))
    const result = await service.completeInspectionRun({ runId: created.run.id, expectedVersion: before!.version }, AUTHOR)

    expect(result.run.partialCount).toBe(1)
    expect(result.run.conformingCount).toBe(brmItems.length - 1)
    // (n-1 + 0.5) / n, redondeado — misma fórmula que lib/sst/compliance.ts.
    const expected = Math.round(((brmItems.length - 1 + 0.5) / brmItems.length) * 100)
    expect(result.compliancePercent).toBe(expected)

    const [stored] = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, created.run.id))
    expect(stored!.partialCount).toBe(1)
    expect(stored!.compliancePercent).toBe(expected)
  })
})

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-in-a", name: "Faena Norte", code: "IN-A", createdAt: now, updatedAt: now },
    { id: "ws-in-b", name: "Faena Sur", code: "IN-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "in-author", name: "Autor", email: "in-author@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "in-approver", name: "Aprobador", email: "in-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "in-reviewer", name: "Revisor", email: "in-reviewer@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "in-outsider", name: "Ajeno", email: "in-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
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

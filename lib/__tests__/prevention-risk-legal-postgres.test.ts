/** Real PostgreSQL proof for MIPER, legal register, PDTP coverage and XLSX staging. */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import ExcelJS from "exceljs"
import postgres from "postgres"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PREVENTION_RISK_DATABASE_URL
const canReset = process.env.PREVENTION_RISK_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
const previousStoragePath = process.env.STORAGE_PATH
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined
let storagePath = ""
let methodologyId = ""
let currentMatrixId = ""
let currentControlId = ""
let legalRequirementId = ""

describeIf("P0-05 MIPER/legal on real PostgreSQL", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_RISK" })
    await ensureDatabaseExists(databaseUrl!)
    await resetDatabase(databaseUrl!)
    const migrationClient = postgres(databaseUrl!, { max: 1, onnotice: () => undefined })
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    await migrationClient.end()
    client = postgres(databaseUrl!, { max: 10, onnotice: () => undefined })
    testDb = drizzle(client, { schema })
    ;(globalThis as typeof globalThis & { __db?: typeof testDb }).__db = testDb
    process.env.DATABASE_URL = databaseUrl
    storagePath = await mkdtemp(path.join(tmpdir(), "chome-risk-test-"))
    process.env.STORAGE_PATH = storagePath
    vi.resetModules()
    await seedFixture(getDb())
  }, 60_000)

  afterAll(async () => {
    ;(globalThis as typeof globalThis & { __db?: unknown }).__db = undefined
    await client?.end()
    if (storagePath) await rm(storagePath, { recursive: true, force: true })
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousStoragePath === undefined) delete process.env.STORAGE_PATH
    else process.env.STORAGE_PATH = previousStoragePath
  })

  it("publishes immutable versions, creates annual/30-day tasks and exposes critical blockers", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const author = access("risk-author", ["prevention:risk:view", "prevention:risk:edit"])
    const reviewer = access("risk-reviewer", ["prevention:risk:review"])
    const approver = access("risk-approver", ["prevention:risk:approve", "prevention:risk:publish"])
    const methodology = await service.ensureIspRiskMethodology(author)
    methodologyId = methodology.id
    const first = await service.createRiskMatrixDraft({
      worksiteId: "ws-risk-a", title: "MIPER Faena Norte", methodologyId,
      revisionReason: "Confección inicial conforme al DS 44 y guía ISP.",
      participationSummary: "Taller con línea de mando, CPHS y personas trabajadoras.",
      consultationEvidenceReference: "acta-participacion-miper-001",
    }, author)
    await service.addRiskEntry(riskEntry(first.id, { hazardCode: "CRIT-01", hazard: "Atropello por equipo móvil", critical: true, controls: [] }), author)
    const controlled = await service.addRiskEntry(riskEntry(first.id, {
      hazardCode: "CTRL-01", hazard: "Contacto con residuo corrosivo", critical: false,
      controls: [{ description: "Segregación y contención del área de transferencia", hierarchy: "engineering", isExisting: true, isCritical: false, responsibleSnapshot: "Jefatura de operaciones", status: "implemented" }],
    }), author)
    await expect(service.transitionRiskMatrix({ matrixId: first.id, expectedVersion: 1, toStatus: "reviewed", reason: "Intento de omitir la revisión formal" }, reviewer)).rejects.toThrow(/transición/i)
    const submitted = await service.transitionRiskMatrix({ matrixId: first.id, expectedVersion: 1, toStatus: "in_review", reason: "Contenido completo enviado a revisión técnica." }, author)
    await expect(service.transitionRiskMatrix({ matrixId: first.id, expectedVersion: submitted.version, toStatus: "reviewed", reason: "Autor intenta revisar su propio trabajo" }, access("risk-author", ["prevention:risk:review"]))).rejects.toThrow(/no puede revisarla/i)
    const reviewed = await service.transitionRiskMatrix({ matrixId: first.id, expectedVersion: submitted.version, toStatus: "reviewed", reason: "Metodología, jerarquía y participación verificadas." }, reviewer)
    const approved = await service.transitionRiskMatrix({ matrixId: first.id, expectedVersion: reviewed.version, toStatus: "approved", reason: "Revisión independiente aceptada para publicación." }, approver)
    const published = await service.transitionRiskMatrix({ matrixId: first.id, expectedVersion: approved.version, toStatus: "published", reason: "Publicación formal de la primera versión MIPER.", effectiveFrom: "2026-07-18" }, approver)
    expect(published).toMatchObject({ status: "published", effectiveFrom: "2026-07-18", reviewDueAt: "2027-07-18" })
    expect(published.publishedHashSha256).toMatch(/^[a-f0-9]{64}$/)
    const [clock] = await getDb().select().from(schema.preventionPdtpUpdateObligations).where(eq(schema.preventionPdtpUpdateObligations.sourceId, first.id))
    expect(clock).toMatchObject({ status: "pending", dueAt: "2026-08-17" })
    const [annual] = await getDb().select().from(schema.preventionRiskReviewTriggers).where(eq(schema.preventionRiskReviewTriggers.idempotencyKey, `miper:annual:${first.id}`))
    expect(annual).toMatchObject({ triggerType: "annual", dueAt: "2027-07-18", status: "pending" })
    const dashboard = await service.getRiskDashboard(access("risk-viewer", ["prevention:risk:view"]))
    expect(dashboard.criticalBlockers.map((item) => item.entry.hazardCode)).toContain("CRIT-01")

    const revision = await service.createRiskMatrixDraft({
      worksiteId: "ws-risk-a", title: "MIPER Faena Norte revisión", methodologyId, sourceMatrixId: first.id,
      revisionReason: "Cambio de condición operacional y nuevo equipo móvil.",
      participationSummary: "Revisión participativa con operadores y Comité Paritario.",
      consultationEvidenceReference: "acta-participacion-miper-002",
    }, author)
    const firstBefore = await getDb().select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, first.id))
    const copied = await getDb().select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, revision.id))
    expect(copied).toHaveLength(firstBefore.length)
    const revisionSubmitted = await service.transitionRiskMatrix({ matrixId: revision.id, expectedVersion: revision.version, toStatus: "in_review", reason: "Revisión actualizada enviada al circuito formal." }, author)
    const revisionReviewed = await service.transitionRiskMatrix({ matrixId: revision.id, expectedVersion: revisionSubmitted.version, toStatus: "reviewed", reason: "Cambios y controles contrastados con terreno." }, reviewer)
    const revisionApproved = await service.transitionRiskMatrix({ matrixId: revision.id, expectedVersion: revisionReviewed.version, toStatus: "approved", reason: "Versión revisada aprobada por jefatura segregada." }, approver)
    const revisionPublished = await service.transitionRiskMatrix({ matrixId: revision.id, expectedVersion: revisionApproved.version, toStatus: "published", reason: "Nueva versión publicada sin sobrescribir la anterior.", effectiveFrom: "2026-08-01" }, approver)
    currentMatrixId = revisionPublished.id
    const [old] = await getDb().select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, first.id))
    const oldEntriesAfter = await getDb().select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, first.id))
    expect(old).toMatchObject({ status: "superseded", version: published.version + 1, publishedHashSha256: published.publishedHashSha256 })
    expect(oldEntriesAfter).toEqual(firstBefore)
    const [supersededHistory] = await getDb().select().from(schema.preventionRiskLegalHistory).where(and(
      eq(schema.preventionRiskLegalHistory.entityId, first.id),
      eq(schema.preventionRiskLegalHistory.changeType, "superseded"),
    ))
    expect(supersededHistory).toMatchObject({
      domain: "risk",
      beforeState: expect.objectContaining({ status: "published", publishedHashSha256: published.publishedHashSha256 }),
      afterState: expect.objectContaining({ status: "superseded", supersededByMatrixId: revision.id }),
    })
    const [copiedControlled] = await getDb().select().from(schema.preventionRiskEntries).where(and(eq(schema.preventionRiskEntries.matrixId, revision.id), eq(schema.preventionRiskEntries.hazardCode, "CTRL-01")))
    const [copiedControl] = await getDb().select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.riskEntryId, copiedControlled!.id))
    expect(copiedControl?.description).toBe(controlled.controls[0]!.description)
    currentControlId = copiedControl!.id

    await expect(service.getPublishedRiskMatrix(revision.id, access("risk-outsider", ["prevention:risk:view"], ["ws-risk-b"]))).rejects.toThrow(/fuera de alcance/i)
    await expect(service.getPublishedRiskMatrix(revision.id, {
      userId: "risk-outsider",
      scope: { mode: "none", ids: [] },
      permissions: ["prevention:risk:view"],
    })).rejects.toThrow(/fuera de alcance/i)

    const concurrent = await service.createRiskMatrixDraft({
      worksiteId: "ws-risk-a", title: "MIPER prueba de concurrencia", methodologyId,
      revisionReason: "Prueba controlada de bloqueo optimista para revisión simultánea.",
      participationSummary: "Escenario técnico con participación documentada para verificar concurrencia.",
      consultationEvidenceReference: "test-concurrency-miper-001",
    }, author)
    await service.addRiskEntry(riskEntry(concurrent.id, { hazardCode: "CONC-01", hazard: "Cambio concurrente de revisión", critical: false, controls: [] }), author)
    const concurrentSubmitted = await service.transitionRiskMatrix({ matrixId: concurrent.id, expectedVersion: concurrent.version, toStatus: "in_review", reason: "Versión enviada para probar dos revisiones simultáneas." }, author)
    const competingReviews = await Promise.allSettled([
      service.transitionRiskMatrix({ matrixId: concurrent.id, expectedVersion: concurrentSubmitted.version, toStatus: "reviewed", reason: "Primera revisión concurrente con la misma versión esperada." }, reviewer),
      service.transitionRiskMatrix({ matrixId: concurrent.id, expectedVersion: concurrentSubmitted.version, toStatus: "reviewed", reason: "Segunda revisión concurrente con la misma versión esperada." }, access("risk-viewer", ["prevention:risk:review"])),
    ])
    expect(competingReviews.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(competingReviews.filter((result) => result.status === "rejected")).toHaveLength(1)
    const concurrentHistory = await getDb().select().from(schema.preventionRiskLegalHistory).where(and(
      eq(schema.preventionRiskLegalHistory.entityId, concurrent.id),
      eq(schema.preventionRiskLegalHistory.changeType, "reviewed"),
    ))
    expect(concurrentHistory).toHaveLength(1)
  })

  it("enforces scoped legal applicability, approval rationale and CAPA for gaps", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const author = access("risk-author", ["prevention:legal:view", "prevention:legal:assess", "prevention:capa:manage"], ["ws-risk-a", "ws-risk-b"])
    const reviewer = access("risk-reviewer", ["prevention:legal:assess"], ["ws-risk-a", "ws-risk-b"])
    const approver = access("risk-approver", ["prevention:legal:approve_applicability"], ["ws-risk-a", "ws-risk-b"])
    const requirement = await service.createLegalRequirementDraft({
      code: "DS44-ART7", sourceType: "regulatory", authority: "Ministerio del Trabajo", sourceTitle: "Decreto Supremo N°44", sourceReference: "DS 44/2024", sourceUrl: "https://www.bcn.cl/leychile/navegar?idNorma=1205298", article: "Artículo 7", requirement: "Confeccionar y revisar una matriz de identificación de peligros y evaluación de riesgos por procesos, tareas y puestos.", versionLabel: "Vigente desde 2025-02-01", validFrom: "2025-02-01", topic: "MIPER", chomeRole: "Entidad empleadora", evidenceRequired: "MIPER publicada, participación y evidencia de revisión", frequency: "Anual y por disparador",
    }, author)
    legalRequirementId = requirement.id
    const submitted = await service.transitionLegalRequirement({ requirementId: requirement.id, expectedVersion: requirement.version, toStatus: "in_review", reason: "Requisito enviado a revisión normativa independiente." }, author)
    const reviewed = await service.transitionLegalRequirement({ requirementId: requirement.id, expectedVersion: submitted.version, toStatus: "reviewed", reason: "Fuente oficial y granularidad del requisito verificadas." }, reviewer)
    const approved = await service.transitionLegalRequirement({ requirementId: requirement.id, expectedVersion: reviewed.version, toStatus: "approved", reason: "Requisito aprobado para incorporar al registro legal." }, approver)
    const published = await service.transitionLegalRequirement({ requirementId: requirement.id, expectedVersion: approved.version, toStatus: "published", reason: "Publicación formal del requisito y su versión vigente." }, approver)
    expect(published.publishedHashSha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(service.proposeLegalApplicability({ requirementId: requirement.id, worksiteId: "ws-risk-b", applicabilityStatus: "proposed_not_applicable", rationale: "No aplica", responsibleSnapshot: "Prevención" }, author)).rejects.toThrow()
    const nonApplicable = await service.proposeLegalApplicability({ requirementId: requirement.id, worksiteId: "ws-risk-b", applicabilityStatus: "proposed_not_applicable", rationale: "La faena se encuentra cerrada y sin personas ni procesos activos.", responsibleSnapshot: "Prevención corporativa" }, author)
    await expect(service.approveLegalApplicability({ applicabilityId: nonApplicable.id, expectedVersion: nonApplicable.version, reason: "Autor intenta aprobar la decisión que evaluó." }, access("risk-author", ["prevention:legal:approve_applicability"], ["ws-risk-b"]))).rejects.toThrow(/no puede aprobarla/i)
    const nonApplicableApproved = await service.approveLegalApplicability({ applicabilityId: nonApplicable.id, expectedVersion: nonApplicable.version, reason: "Fundamento y ausencia de actividad contrastados documentalmente." }, approver)
    expect(nonApplicableApproved).toMatchObject({ applicabilityStatus: "not_applicable", approvedByUserId: "risk-approver" })
    const applicable = await service.proposeLegalApplicability({ requirementId: requirement.id, worksiteId: "ws-risk-a", applicabilityStatus: "proposed_applicable", rationale: "La faena mantiene procesos activos y personal expuesto a peligros.", responsibleSnapshot: "Jefatura de prevención", evidenceDueAt: "2026-08-20" }, author)
    const applicableApproved = await service.approveLegalApplicability({ applicabilityId: applicable.id, expectedVersion: applicable.version, reason: "Aplicabilidad confirmada contra la operación vigente de la faena." }, approver)
    const assessed = await service.assessLegalCompliance({ applicabilityId: applicable.id, expectedVersion: applicableApproved.version, status: "noncompliant", finding: "La versión MIPER requiere completar cobertura de un riesgo crítico.", nextAssessmentAt: "2026-09-01", capa: { actionDescription: "Implementar y verificar el control crítico faltante.", responsibleSnapshot: "Jefatura de operaciones", targetDate: "2026-08-25", priority: "critical" } }, author)
    expect(assessed.assessment.capaActionId).toBeTruthy()
    const [capa] = await getDb().select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, assessed.assessment.capaActionId!))
    expect(capa).toMatchObject({ sourceType: "legal_requirement", worksiteId: "ws-risk-a", priority: "critical" })
    const foreign = await service.getLegalDashboard(access("risk-outsider", ["prevention:legal:view"], ["ws-risk-b"]))
    expect(foreign.applicabilities.some((item) => item.applicability.worksiteId === "ws-risk-a")).toBe(false)

    const revision = await service.createLegalRequirementDraft({
      code: "DS44-ART7", sourceRequirementId: requirement.id, sourceType: "regulatory", authority: "Ministerio del Trabajo",
      sourceTitle: "Decreto Supremo N°44", sourceReference: "DS 44/2024", sourceUrl: "https://www.bcn.cl/leychile/navegar?idNorma=1205298",
      article: "Artículo 7", requirement: "Confeccionar, revisar y mantener trazable la matriz de identificación de peligros y evaluación de riesgos.",
      versionLabel: "Revisión interna 2026", validFrom: "2025-02-01", topic: "MIPER", chomeRole: "Entidad empleadora",
      evidenceRequired: "MIPER publicada, participación e historial de revisión", frequency: "Anual y por disparador",
    }, author)
    const revisionSubmitted = await service.transitionLegalRequirement({ requirementId: revision.id, expectedVersion: revision.version, toStatus: "in_review", reason: "Actualización normativa enviada a revisión independiente." }, author)
    const revisionReviewed = await service.transitionLegalRequirement({ requirementId: revision.id, expectedVersion: revisionSubmitted.version, toStatus: "reviewed", reason: "Nueva redacción y fuente oficial contrastadas." }, reviewer)
    const revisionApproved = await service.transitionLegalRequirement({ requirementId: revision.id, expectedVersion: revisionReviewed.version, toStatus: "approved", reason: "Versión actualizada aprobada por rol segregado." }, approver)
    const revisionPublished = await service.transitionLegalRequirement({ requirementId: revision.id, expectedVersion: revisionApproved.version, toStatus: "published", reason: "Nueva versión del requisito publicada sin sobrescribir evidencia." }, approver)
    const revisedApplicability = await service.proposeLegalApplicability({
      requirementId: revisionPublished.id,
      worksiteId: "ws-risk-a",
      applicabilityStatus: "proposed_applicable",
      rationale: "La nueva versión mantiene el mismo ámbito material en la faena con procesos activos.",
      responsibleSnapshot: "Jefatura de prevención",
      evidenceDueAt: "2026-09-20",
    }, author)
    await service.approveLegalApplicability({
      applicabilityId: revisedApplicability.id,
      expectedVersion: revisedApplicability.version,
      reason: "Continuidad de aplicabilidad verificada contra la operación vigente.",
    }, approver)
    legalRequirementId = revisionPublished.id
    const [oldRequirement] = await getDb().select().from(schema.preventionLegalRequirements).where(eq(schema.preventionLegalRequirements.id, requirement.id))
    expect(oldRequirement).toMatchObject({ status: "superseded", version: published.version + 1, publishedHashSha256: published.publishedHashSha256 })
    const [legalSupersededHistory] = await getDb().select().from(schema.preventionRiskLegalHistory).where(and(
      eq(schema.preventionRiskLegalHistory.entityId, requirement.id),
      eq(schema.preventionRiskLegalHistory.changeType, "superseded"),
    ))
    expect(legalSupersededHistory).toMatchObject({
      domain: "legal",
      beforeState: expect.objectContaining({ status: "published", publishedHashSha256: published.publishedHashSha256 }),
      afterState: expect.objectContaining({ status: "superseded", supersededByRequirementId: revision.id }),
    })
  })

  it("links every covered PDTP measure to a navigable source and closes the 30-day clock only after coverage", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const pdtpProgramsService = await import("@/lib/services/pdtp/programs")
    const manager = access("risk-author", ["prevention:pdtp:view", "prevention:pdtp:program:manage"])
    const link = await service.linkPdtpActivitySource({ activityId: "pdtp-risk-activity", worksiteId: "ws-risk-a", sourceType: "risk_control", sourceId: currentControlId, justification: "El control MIPER requiere verificación mensual programada en el PDTP." }, manager)
    expect(link).toMatchObject({ sourceType: "risk_control", sourceId: currentControlId })
    const [clock] = await getDb().select().from(schema.preventionPdtpUpdateObligations).where(eq(schema.preventionPdtpUpdateObligations.sourceId, currentMatrixId))
    expect(clock).toBeDefined()
    const resolved = await service.resolvePdtpUpdateObligation({ obligationId: clock!.id, programId: "pdtp-risk-program", resolution: "La actividad PDTP incorpora el control MIPER y su verificación periódica." }, manager)
    expect(resolved).toMatchObject({ status: "addressed", addressedByProgramId: "pdtp-risk-program" })
    const legalLink = await service.linkPdtpActivitySource({ activityId: "pdtp-legal-activity", worksiteId: "ws-risk-a", sourceType: "legal_requirement", sourceId: legalRequirementId, justification: "La actividad mantiene evidencia periódica del requisito DS 44 artículo 7." }, manager)
    expect(legalLink.sourceVersionSnapshot).toMatch(/DS44-ART7/)
    const coverage = await service.getPdtpCoverage("pdtp-risk-program", manager)
    expect(coverage.coverage).toMatchObject({ totalActivities: 3, sourcedActivities: 2, unsourcedActivities: 1 })
    expect(coverage.activities.find((item) => item.id === "pdtp-risk-activity")?.sources[0]?.sourceId).toBe(currentControlId)
    await expect(service.linkPdtpActivitySource({ activityId: "pdtp-risk-activity", worksiteId: "ws-risk-a", sourceType: "risk_control", sourceId: currentControlId, justification: "Intento duplicado del mismo vínculo de cobertura." }, access("risk-outsider", ["prevention:pdtp:program:manage"], ["ws-risk-b"]))).rejects.toThrow(/fuera de alcance/i)

    const copiedProgram = await pdtpProgramsService.createPdtpProgram({
      year: 2026,
      title: "PDTP pruebas P0-05 copiado",
      userId: "risk-author",
      copySheetsFromProgramId: "pdtp-risk-program",
    })
    const copiedCoverage = await service.getPdtpCoverage(copiedProgram.id, manager)
    expect(copiedCoverage.coverage).toMatchObject({ totalActivities: 3, sourcedActivities: 2, unsourcedActivities: 1 })
    expect(copiedCoverage.activities.find((item) => item.n === 1)?.sources[0]).toMatchObject({
      sourceType: "risk_control",
      sourceId: currentControlId,
      sourceVersionSnapshot: link.sourceVersionSnapshot,
      createdByUserId: "risk-author",
    })
    expect(copiedCoverage.activities.find((item) => item.n === 2)?.sources[0]).toMatchObject({
      sourceType: "legal_requirement",
      sourceId: legalRequirementId,
      sourceVersionSnapshot: legalLink.sourceVersionSnapshot,
    })
    expect(copiedCoverage.activities.find((item) => item.n === 1)?.sources[0]?.justification).toContain("Copiado desde pdtp-risk-program")
  })

  it("preserves XLSX original, normalization and activation decisions without cross-faena access", async () => {
    const importer = await import("@/lib/services/prevention-risk-import")
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("MIPER")
    sheet.addRow(["Proceso", "Tarea", "Puesto de trabajo", "Peligro", "Factor de riesgo", "Evento o daño", "Nivel inherente", "Nivel residual", "Responsable", "Controles"])
    sheet.addRow(["Recepción", "Descargar contenedor", "Operador", "Caída de carga", "Carga suspendida", "Lesión grave", "Alto", "Medio", "Jefatura de patio", "Ingeniería: barrera física y zona de exclusión"])
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
    const author = access("risk-author", ["prevention:risk:view", "prevention:risk:edit"])
    const approver = access("risk-approver", ["prevention:risk:approve"])
    const staged = await importer.stageRiskImport({ worksiteId: "ws-risk-a", fileName: "miper_fuente.xlsx", buffer: bytes, access: author })
    expect(staged.idempotentReplay).toBe(false)
    const [row] = await getDb().select().from(schema.preventionRiskImportRows).where(eq(schema.preventionRiskImportRows.batchId, staged.batch.id))
    expect(row).toMatchObject({ status: "ready", original: expect.objectContaining({ processName: "Recepción" }), normalized: expect.objectContaining({ hazard: "Caída de carga" }) })
    await expect(importer.approveRiskImportBatch(staged.batch.id, access("risk-author", ["prevention:risk:approve"]))).rejects.toThrow(/no puede aprobar/i)
    await importer.approveRiskImportBatch(staged.batch.id, approver)
    const activated = await importer.activateRiskImportBatch({ batchId: staged.batch.id, title: "MIPER importada desde planilla histórica", methodologyId, revisionReason: "Migración controlada de la matriz histórica operacional.", participationSummary: "Normalización revisada con responsables de proceso y prevención.", consultationEvidenceReference: "acta-importacion-miper-001" }, author)
    expect(activated).toMatchObject({ completed: true, remaining: 0 })
    const [activatedRow] = await getDb().select().from(schema.preventionRiskImportRows).where(eq(schema.preventionRiskImportRows.id, row!.id))
    const [entry] = await getDb().select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, activatedRow!.riskEntryId!))
    expect(activatedRow).toMatchObject({ status: "activated", original: row!.original, normalized: row!.normalized })
    expect(entry).toMatchObject({ sourceOriginal: row!.original, sourceNormalized: row!.normalized, normalizationDecision: expect.stringContaining("automática") })
    const replay = await importer.stageRiskImport({ worksiteId: "ws-risk-a", fileName: "otra_copia.xlsx", buffer: bytes, access: author })
    expect(replay).toMatchObject({ idempotentReplay: true, batch: { id: staged.batch.id } })
    await expect(importer.getRiskImportSourceFile(staged.batch.id, access("risk-outsider", ["prevention:risk:view"], ["ws-risk-b"]))).rejects.toThrow(/fuera de alcance/i)
    await expect(importer.getRiskImportSourceFile(staged.batch.id, { userId: "risk-outsider", scope: { mode: "none", ids: [] }, permissions: ["prevention:risk:view"] })).rejects.toThrow(/fuera de alcance/i)
  })
})

function access(userId: string, permissions: string[], ids: string[] = ["ws-risk-a"]) {
  return { userId, scope: { mode: "some" as const, ids }, permissions }
}

function riskEntry(matrixId: string, args: { hazardCode: string; hazard: string; critical: boolean; controls: Array<Record<string, unknown>> }) {
  return {
    matrixId,
    process: { code: "PROC-01", name: "Gestión de residuos" },
    task: { code: "TASK-01", name: "Transferir residuos", isRoutine: true },
    position: { code: "POS-01", name: "Operador de residuos" },
    hazardCode: args.hazardCode,
    hazard: args.hazard,
    riskFactor: "Operación industrial y circulación de equipos",
    expectedEventOrDamage: "Lesión con tiempo perdido o daño grave",
    exposedPeopleDescription: "Operadores y personal de apoyo",
    exposedPeopleCount: 5,
    genderConsiderations: "Evaluar diferencias de exposición, ajuste de EPP y organización del trabajo.",
    sensitiveWorkerConsiderations: "Validar restricciones y personas especialmente sensibles sin exponer diagnósticos.",
    inherentDimensions: { probability: 4, consequence: 5 },
    inherentScore: 20,
    inherentLevel: "Alto",
    residualDimensions: { probability: 3, consequence: 5 },
    residualScore: 15,
    residualLevel: "Alto",
    isCritical: args.critical,
    responsibleSnapshot: "Jefatura de operaciones",
    controls: args.controls,
  }
}

function getDb() {
  if (!testDb) throw new Error("Risk/legal test database was not initialized")
  return testDb
}

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-risk-a", name: "Faena Norte", code: "RISK-A", createdAt: now, updatedAt: now },
    { id: "ws-risk-b", name: "Faena Sur", code: "RISK-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "risk-author", name: "Autor", email: "risk-author@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "risk-reviewer", name: "Revisor", email: "risk-reviewer@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "risk-approver", name: "Aprobador", email: "risk-approver@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "risk-viewer", name: "Lector", email: "risk-viewer@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "risk-outsider", name: "Ajeno", email: "risk-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.pdtpPrograms).values({ id: "pdtp-risk-program", year: 2026, version: 1, status: "active", title: "PDTP pruebas P0-05", elaboratedByUserId: "risk-author", elaboratedByName: "Autor", elaboratedByTitle: "Prevencionista", createdAt: now, updatedAt: now })
  await database.insert(schema.pdtpActivities).values([
    { id: "pdtp-risk-activity", programId: "pdtp-risk-program", n: 1, objectiveOrder: 1, objective: "Controlar riesgos críticos", activity: "Verificar control de ingeniería", program: "MIPER", responsibleSlugs: ["prevencion"], responsibleDisplay: "Prevención", sourceSheetRow: 1, createdAt: now, updatedAt: now },
    { id: "pdtp-legal-activity", programId: "pdtp-risk-program", n: 2, objectiveOrder: 1, objective: "Cumplir requisitos", activity: "Revisar evidencia legal", program: "Legal", responsibleSlugs: ["prevencion"], responsibleDisplay: "Prevención", sourceSheetRow: 2, createdAt: now, updatedAt: now },
    { id: "pdtp-unsourced-activity", programId: "pdtp-risk-program", n: 3, objectiveOrder: 1, objective: "Objetivo interno", activity: "Actividad aún no conciliada", program: "Interno", responsibleSlugs: ["prevencion"], responsibleDisplay: "Prevención", sourceSheetRow: 3, createdAt: now, updatedAt: now },
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

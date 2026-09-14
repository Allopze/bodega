/** Real PostgreSQL proof for MIPER, legal register, PDTP coverage and Excel staging. */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import ExcelJS from "exceljs"
import postgres from "postgres"
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm"
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
let currentMatrixIdB = ""
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
    /* Publicar dejó de poder hacerlo quien aprobó: la cuarta firma también se
     * segrega por actor. La jefatura técnica del área es la única exenta. */
    const publisher = access("risk-publisher", ["prevention:risk:publish"])
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
    await expect(service.transitionRiskMatrix({ matrixId: first.id, expectedVersion: approved.version, toStatus: "published", reason: "Quien aprobó intenta publicar.", effectiveFrom: "2026-07-18" }, approver)).rejects.toThrow(/no puede publicarla/i)
    const published = await service.transitionRiskMatrix({ matrixId: first.id, expectedVersion: approved.version, toStatus: "published", reason: "Publicación formal de la primera versión MIPER.", effectiveFrom: "2026-07-18" }, publisher)
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
    const revisionPublished = await service.transitionRiskMatrix({ matrixId: revision.id, expectedVersion: revisionApproved.version, toStatus: "published", reason: "Nueva versión publicada sin sobrescribir la anterior.", effectiveFrom: "2026-08-01" }, publisher)
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

  /* MIPER-07 (cierre): el guard de más abajo valida la sesión, pero mientras
   * ningún formulario la enviara la columna era siempre NULL y el crédito Oro
   * `iper_committee_participation` daba `not_met` para siempre — con revisiones
   * MIPER en el período y sin forma alguna de cumplirlo desde la aplicación.
   * Esto prueba el ciclo entero: el panel ofrece las sesiones elegibles, la
   * revisión las declara y la certificación las cuenta.
   *
   * Va ANTES del guard a propósito: el "antes" necesita que ninguna matriz de
   * ws-risk-a declare sesión todavía, y ese guard crea la primera. */
  it("turns the Oro CPHS-participation credit from unreachable into reachable", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const { gatherCertificationEvidence } = await import("@/lib/services/prevention-cphs-certification")
    const { evaluateLevel } = await import("@/lib/prevention/cphs-certification")
    const { todayInChile } = await import("@/lib/utils")
    const author = access("risk-author", ["prevention:risk:view", "prevention:risk:edit"])
    const period = { committeeId: "cphs-risk-a", worksiteId: "ws-risk-a", periodYear: Number(todayInChile().slice(0, 4)) }

    // El desplegable del diálogo sólo puede ofrecer lo que trae el panel: las
    // sesiones del comité de una faena visible, sin las canceladas.
    const dashboard = await service.getRiskDashboard(access("risk-viewer", ["prevention:risk:view"]))
    expect(dashboard.committeeMeetings).toEqual([
      expect.objectContaining({ id: "cphs-meet-a", worksiteId: "ws-risk-a", code: "CPHS-A-001" }),
    ])

    const before = await gatherCertificationEvidence(period)
    expect(before.iperRevisionsTotal).toBeGreaterThan(0)
    expect(before.iperRevisionsWithCommittee).toBe(0)
    expect(evaluateLevel("oro", before, new Map()).find((item) => item.code === "iper_committee_participation"))
      .toMatchObject({ status: "not_met" })

    await service.createRiskMatrixDraft({
      worksiteId: "ws-risk-a", title: "MIPER revisada en sesión del comité", methodologyId,
      committeeMeetingId: dashboard.committeeMeetings[0]!.id,
      revisionReason: "Revisión anual acordada y ejecutada en sesión del Comité Paritario.",
      participationSummary: "La matriz se revisó punto por punto en la sesión ordinaria del comité.",
      consultationEvidenceReference: "acta-cphs-miper-credito-oro",
    }, author)

    const after = await gatherCertificationEvidence(period)
    expect(after.iperRevisionsTotal).toBe(before.iperRevisionsTotal + 1)
    expect(after.iperRevisionsWithCommittee).toBe(1)
    expect(evaluateLevel("oro", after, new Map()).find((item) => item.code === "iper_committee_participation"))
      .toMatchObject({ status: "met" })
  })

  // MIPER-07: `committee_meeting_id` es la evidencia verificable de la
  // participación del CPHS (crédito Oro `iper_committee_participation`). La FK
  // sólo exige que el id exista, así que el acta de otra faena o una sesión
  // cancelada acreditaban participación que nunca ocurrió en ese centro.
  it("rejects a committee meeting from another worksite or a cancelled one, and accepts a valid session", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const author = access("risk-author", ["prevention:risk:view", "prevention:risk:edit"])
    const draft = (committeeMeetingId: string) => ({
      worksiteId: "ws-risk-a", title: "MIPER con sesión del comité", methodologyId, committeeMeetingId,
      revisionReason: "Revisión participativa acordada en sesión del Comité Paritario.",
      participationSummary: "Revisión de la matriz en sesión ordinaria del comité con acta firmada.",
      consultationEvidenceReference: "acta-cphs-miper-001",
    })

    // Un solo mensaje para los tres casos, a propósito: distinguirlos revelaría
    // qué ids de sesión existen en faenas ajenas. Lo que discrimina que el guard
    // no rechaza todo es el control positivo del final.
    const rejected = /no existe, es de otra faena o está cancelada/i
    await expect(service.createRiskMatrixDraft(draft("cphs-meet-b"), author)).rejects.toThrow(rejected)
    await expect(service.createRiskMatrixDraft(draft("cphs-meet-a-cancelled"), author)).rejects.toThrow(rejected)
    await expect(service.createRiskMatrixDraft(draft("cphs-meet-inexistente"), author)).rejects.toThrow(rejected)
    const notCreated = await getDb().select({ id: schema.preventionRiskMatrices.id }).from(schema.preventionRiskMatrices)
      .where(eq(schema.preventionRiskMatrices.title, "MIPER con sesión del comité"))
    expect(notCreated).toEqual([])

    const accepted = await service.createRiskMatrixDraft(draft("cphs-meet-a"), author)
    expect(accepted).toMatchObject({ worksiteId: "ws-risk-a", committeeMeetingId: "cphs-meet-a", status: "draft" })
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

    // 2027 y no 2026: `pdtp_programs_year_unique` admite un solo programa por
    // año, así que un segundo 2026 no puede existir — el helper reintentaba
    // ocho veces creyendo que era una carrera de versiones y terminaba
    // reportando una concurrencia que no había. Copiar a otro año es además el
    // caso real de esta operación: el rollover anual.
    const copiedProgram = await pdtpProgramsService.createLegacyPdtpProgramForTests({
      year: 2027,
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

  it("preserves Excel original, normalization and activation decisions without cross-faena access", async () => {
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

  /* ── Fase 4 · MIPER ─────────────────────────────────────────────────────────
   * Todo lo que sigue trabaja sobre ws-risk-b para no tocar la matriz vigente de
   * ws-risk-a, de la que dependen las pruebas de cobertura PDTP de más arriba
   * (`prevention_risk_matrices_one_published_scope_unique` es por faena). */

  // MIPER-10: la máquina de estados sólo avanzaba. Una versión enviada a
  // revisión con un error quedaba trabada: el revisor no podía devolverla y
  // `addRiskEntry` exige 'draft', así que tampoco se podía corregir.
  it("lets the reviewer return a matrix from in_review to draft, and nobody else", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const author = accessB("risk-author", ["prevention:risk:view", "prevention:risk:edit"])
    const reviewer = accessB("risk-reviewer", ["prevention:risk:review"])
    const draft = await service.createRiskMatrixDraft(matrixDraft("MIPER Faena Sur borrador devuelto"), author)
    await service.addRiskEntry(riskEntryB(draft.id, { hazardCode: "RET-01", hazard: "Peligro con evaluación equivocada", critical: false, controls: [] }), author)
    const submitted = await service.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: draft.version, toStatus: "in_review", reason: "Enviada a revisión con una evaluación por corregir." }, author)

    // El autor tiene `:edit`, no `:review`: devolver es una decisión de revisión.
    await expect(service.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: submitted.version, toStatus: "draft", reason: "El autor intenta recuperar su propia versión." }, author))
      .rejects.toThrow(/fuera de alcance/i)

    const returned = await service.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: submitted.version, toStatus: "draft", reason: "La evaluación residual del peligro RET-01 no corresponde a la metodología." }, reviewer)
    expect(returned).toMatchObject({ status: "draft", version: submitted.version + 1, reviewedByUserId: null })
    const [returnHistory] = await getDb().select().from(schema.preventionRiskLegalHistory).where(and(
      eq(schema.preventionRiskLegalHistory.entityId, draft.id),
      eq(schema.preventionRiskLegalHistory.changeType, "draft"),
    ))
    expect(returnHistory).toMatchObject({ actorUserId: "risk-reviewer", reason: expect.stringContaining("RET-01") })

    // Y en borrador vuelve a admitir cambios, que es de lo que se trataba.
    await service.addRiskEntry(riskEntryB(draft.id, { hazardCode: "RET-02", hazard: "Peligro agregado tras la devolución", critical: false, controls: [] }), author)
    // 'draft' no es un destino desde cualquier estado: sólo se devuelve lo que
    // está en revisión.
    await expect(service.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: returned.version + 1, toStatus: "draft", reason: "Intento de devolver algo que ya está en borrador." }, reviewer))
      .rejects.toThrow(/transición miper inválida/i)
  })

  // MIPER-05: los marcadores del mapa cuelgan de una fila de
  // `prevention_risk_entries`; publicar una revisión dejaba esa fila en una
  // matriz `superseded` y el plano seguía mostrando peligros de una MIPER que ya
  // no rige.
  it("repoints risk map markers to the new published version and retires the ones whose hazard is gone", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const mapService = await import("@/lib/services/prevention-risk-map")
    const author = accessB("risk-author", ["prevention:risk:view", "prevention:risk:edit"])

    const v1 = await publishMatrixB(service, "MIPER Faena Sur v1", [
      { hazardCode: "MAP-01", hazard: "Atrapamiento en cinta transportadora", critical: false, controls: [] },
      { hazardCode: "MAP-02", hazard: "Ruido sobre el límite permisible", critical: false, controls: [] },
    ])
    const entriesV1 = await getDb().select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, v1.id))
    const keptV1 = entriesV1.find((entry) => entry.hazardCode === "MAP-01")!
    const droppedV1 = entriesV1.find((entry) => entry.hazardCode === "MAP-02")!

    const layout = await mapService.uploadRiskMapLayout({ worksiteId: "ws-risk-b", title: "Planta Faena Sur", imagePath: "storage/risk-maps/faena-sur.png", imageMimeType: "image/png" }, author)
    const keptMarker = await mapService.addRiskMapMarker({ layoutId: layout.id, riskEntryId: keptV1.id, xPct: 20, yPct: 30, label: "Cinta 1" }, author)
    const droppedMarker = await mapService.addRiskMapMarker({ layoutId: layout.id, riskEntryId: droppedV1.id, xPct: 60, yPct: 70, label: "Sala de bombas" }, author)

    // Un marcador tampoco puede nacer sobre una entrada que no rige: el picker
    // sólo ofrece las publicadas, pero eso era cortesía de la UI, no una regla.
    const parkedDraft = await service.createRiskMatrixDraft(matrixDraft("MIPER Faena Sur borrador paralelo"), author)
    const { entry: draftEntry } = await service.addRiskEntry(riskEntryB(parkedDraft.id, { hazardCode: "MAP-09", hazard: "Peligro que sigue en borrador", critical: false, controls: [] }), author)
    await expect(mapService.addRiskMapMarker({ layoutId: layout.id, riskEntryId: draftEntry.id, xPct: 10, yPct: 10, label: null }, author))
      .rejects.toThrow(/matriz miper vigente/i)

    // v2 conserva MAP-01 (mismo proceso/tarea/puesto/código: la identidad
    // estable) y retira MAP-02.
    const v2 = await publishMatrixB(service, "MIPER Faena Sur v2", [
      { hazardCode: "MAP-01", hazard: "Atrapamiento en cinta transportadora", critical: true, controls: [{ description: "Enclavamiento de parada de emergencia en la cinta", hierarchy: "engineering", isExisting: true, isCritical: true, performanceStandard: "Detención total en menos de dos segundos", verificationFrequency: "Mensual", responsibleSnapshot: "Jefatura de mantención", status: "implemented" }] }],
    )
    const [supersededV1] = await getDb().select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, v1.id))
    expect(supersededV1).toMatchObject({ status: "superseded" })

    const [keptV2] = await getDb().select().from(schema.preventionRiskEntries).where(and(
      eq(schema.preventionRiskEntries.matrixId, v2.id),
      eq(schema.preventionRiskEntries.hazardCode, "MAP-01"),
    ))
    const [repointed] = await getDb().select().from(schema.preventionRiskMapMarkers).where(eq(schema.preventionRiskMapMarkers.id, keptMarker.id))
    expect(repointed).toMatchObject({ riskEntryId: keptV2!.id, xPct: 20, yPct: 30, label: "Cinta 1" })
    expect(repointed!.riskEntryId).not.toBe(keptV1.id)

    const orphaned = await getDb().select().from(schema.preventionRiskMapMarkers).where(eq(schema.preventionRiskMapMarkers.id, droppedMarker.id))
    expect(orphaned).toEqual([])
    const [orphanHistory] = await getDb().select().from(schema.preventionRiskLegalHistory).where(and(
      eq(schema.preventionRiskLegalHistory.entityId, droppedMarker.id),
      eq(schema.preventionRiskLegalHistory.changeType, "orphaned"),
    ))
    expect(orphanHistory).toMatchObject({ beforeState: expect.objectContaining({ hazardCode: "MAP-02", label: "Sala de bombas" }) })

    // La afirmación del informe, comprobada sobre la tabla y no sobre el flujo:
    // ningún marcador de ninguna faena sirve una entrada de matriz reemplazada.
    const servingSuperseded = await getDb().select({ id: schema.preventionRiskMapMarkers.id })
      .from(schema.preventionRiskMapMarkers)
      .innerJoin(schema.preventionRiskEntries, eq(schema.preventionRiskEntries.id, schema.preventionRiskMapMarkers.riskEntryId))
      .innerJoin(schema.preventionRiskMatrices, eq(schema.preventionRiskMatrices.id, schema.preventionRiskEntries.matrixId))
      .where(ne(schema.preventionRiskMatrices.status, "published"))
    expect(servingSuperseded).toEqual([])

    const view = await mapService.listRiskMapsForScope(["ws-risk-b"], author)
    expect(view.get("ws-risk-b")?.markers).toEqual([expect.objectContaining({ riskEntryId: keptV2!.id, hazard: "Atrapamiento en cinta transportadora", residualLevel: "high" })])
    currentMatrixIdB = v2.id
  })

  // MIPER-08: el único camino a 'verified' era el propio payload que creaba el
  // peligro — el autor se declaraba verificador, sin evidencia y sin que nadie
  // más lo mirara.
  it("refuses a control born verified and demands evidence plus a segregated actor to verify one", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const author = accessB("risk-author", ["prevention:risk:view", "prevention:risk:edit"])
    const verifier = accessB("risk-reviewer", ["prevention:risk:view", "prevention:risk:edit"])

    const draft = await service.createRiskMatrixDraft(matrixDraft("MIPER Faena Sur control autoverificado"), author)
    await expect(service.addRiskEntry(riskEntryB(draft.id, {
      hazardCode: "VER-01", hazard: "Peligro con control autoverificado", critical: false,
      controls: [{ description: "Control que el propio autor declara verificado", hierarchy: "administrative", isExisting: true, isCritical: false, responsibleSnapshot: "Prevención", status: "verified" }],
    }), author)).rejects.toThrow()
    const notCreated = await getDb().select({ id: schema.preventionRiskEntries.id }).from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.hazardCode, "VER-01"))
    expect(notCreated).toEqual([])

    const [control] = await getDb().select().from(schema.preventionRiskControls)
      .innerJoin(schema.preventionRiskEntries, eq(schema.preventionRiskEntries.id, schema.preventionRiskControls.riskEntryId))
      .where(eq(schema.preventionRiskEntries.matrixId, currentMatrixIdB))
    const target = control!.prevention_risk_controls
    expect(target).toMatchObject({ status: "implemented", effectivenessStatus: "not_assessed", lastVerifiedByUserId: null })

    const verification = { controlId: target.id, expectedVersion: target.version, effectivenessStatus: "effective" as const, verificationNote: "Prueba funcional del enclavamiento en terreno con detención medida." }
    // Sin evidencia no hay verificación: el contrato la exige antes de llegar al
    // servicio.
    await expect(service.verifyRiskControl({ ...verification, evidenceReference: "" }, verifier)).rejects.toThrow()
    // El autor de la versión no verifica su propio control…
    await expect(service.verifyRiskControl({ ...verification, evidenceReference: "acta-verificacion-cinta-001" }, author))
      .rejects.toThrow(/persona distinta/i)
    // …ni con el motivo de excepción si no tiene el permiso de override…
    await expect(service.verifyRiskControl({ ...verification, evidenceReference: "acta-verificacion-cinta-001", segregationExceptionReason: "Único prevencionista disponible en la faena esa semana." }, author))
      .rejects.toThrow(/persona distinta/i)
    // …ni con el permiso y un motivo que no fundamenta nada.
    await expect(service.verifyRiskControl({ ...verification, evidenceReference: "acta-verificacion-cinta-001", segregationExceptionReason: "urgente" }, accessB("risk-author", ["prevention:risk:edit", "prevention:risk:override_segregation"])))
      .rejects.toThrow(/persona distinta/i)

    const verified = await service.verifyRiskControl({ ...verification, evidenceReference: "acta-verificacion-cinta-001" }, verifier)
    expect(verified).toMatchObject({ status: "verified", effectivenessStatus: "effective", lastVerifiedByUserId: "risk-reviewer", evidenceReference: "acta-verificacion-cinta-001", version: target.version + 1 })
    const [entryAfter] = await getDb().select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.id, target.riskEntryId))
    expect(entryAfter!.version).toBeGreaterThan(1)
    const [verifiedHistory] = await getDb().select().from(schema.preventionRiskLegalHistory).where(and(
      eq(schema.preventionRiskLegalHistory.entityId, target.id),
      eq(schema.preventionRiskLegalHistory.changeType, "verified"),
    ))
    expect(verifiedHistory).toMatchObject({ actorUserId: "risk-reviewer", afterState: expect.objectContaining({ segregationExceptionReason: null }) })

    // La excepción fundamentada sí pasa, y queda escrita en el historial: es lo
    // que un fiscalizador viene a leer.
    const overridden = await service.verifyRiskControl({
      controlId: target.id, expectedVersion: verified.version, effectivenessStatus: "ineffective",
      evidenceReference: "acta-verificacion-cinta-002",
      verificationNote: "El enclavamiento detiene la cinta fuera del tiempo del estándar.",
      segregationExceptionReason: "Faena sin segunda persona competente durante el turno de verificación.",
    }, accessB("risk-author", ["prevention:risk:edit", "prevention:risk:override_segregation"]))
    expect(overridden).toMatchObject({ status: "ineffective", effectivenessStatus: "ineffective" })
    const [overrideHistory] = await getDb().select().from(schema.preventionRiskLegalHistory).where(and(
      eq(schema.preventionRiskLegalHistory.entityId, target.id),
      eq(schema.preventionRiskLegalHistory.changeType, "ineffective"),
    ))
    expect(overrideHistory).toMatchObject({ afterState: expect.objectContaining({ segregationExceptionReason: "Faena sin segunda persona competente durante el turno de verificación." }) })
    // Un control crítico ineficaz abre revisión de la matriz, no queda en nada.
    const [trigger] = await getDb().select().from(schema.preventionRiskReviewTriggers).where(eq(schema.preventionRiskReviewTriggers.sourceId, target.id))
    expect(trigger).toMatchObject({ triggerType: "critical_control_failure", status: "pending" })
    /*
     * E2E-005 (auditoría 2026-09-14): el disparador de revisión era TODO lo que
     * ocurría, y vive sólo en el tablero de MIPER. La falla de un control
     * crítico ahora abre además acción correctiva con origen `risk`, que hasta
     * entonces era un valor del enum sin ningún escritor.
     */
    const [capa] = await getDb().select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.sourceId, target.id))
    expect(capa).toMatchObject({ sourceType: "risk", status: "pending", reconciliationStatus: "needs_assignment" })
  })

  // MIPER-04: `ready` lo decidía una lista de mínimos más débil que el contrato
  // real (`riskEntrySchema`), así que una fila marcada activable reventaba la
  // transacción de activación entera — y el lote quedaba aprobado, no activable
  // y no corregible (`resolveRiskImportRow` exige 'staged').
  it("keeps every ready row activatable, names the failing row and offers a way out of a dead batch", async () => {
    const importer = await import("@/lib/services/prevention-risk-import")
    const author = accessB("risk-author", ["prevention:risk:view", "prevention:risk:edit"])
    const approver = accessB("risk-approver", ["prevention:risk:approve"])

    // Fila 2: nivel residual fuera del vocabulario — pasaba `issuesFor` (no está
    // vacío) y moría en Zod al activar. Fila 3 y 4: misma identidad MIPER con
    // distinta redacción — pasaban el filtro de duplicados y chocaban contra
    // `prevention_risk_entries_matrix_identity_unique`.
    const staged = await importer.stageRiskImport({
      worksiteId: "ws-risk-b", fileName: "miper_trampas.xlsx", access: author,
      buffer: await miperWorkbook([
        ["Bodega", "Ordenar pallets", "Bodeguero", "Caída de altura", "Trabajo en altura", "Fractura", "Alto", "Regular", "Jefatura de bodega", "Administrativo: procedimiento de trabajo en altura"],
        ["Bodega", "Ordenar pallets", "Bodeguero", "Golpe con pallet", "Manipulación manual", "Contusión", "Medio", "Bajo", "Jefatura de bodega", "Administrativo: instructivo de manipulación"],
        ["Bodega", "Ordenar pallets", "Bodeguero", "Golpe con pallet apilado", "Manipulación manual", "Contusión", "Medio", "Bajo", "Jefatura de bodega", "Administrativo: instructivo de manipulación"],
      ], { hazardCodes: ["ALT-01", "GOL-01", "GOL-01"] }),
    })
    const rows = await getDb().select().from(schema.preventionRiskImportRows).where(eq(schema.preventionRiskImportRows.batchId, staged.batch.id)).orderBy(asc(schema.preventionRiskImportRows.rowNumber))
    expect(rows.map((row) => row.status)).toEqual(["needs_review", "ready", "duplicate"])
    expect((rows[0]!.issues as string[]).join(" ")).toMatch(/residualLevel/i)

    // Toda fila `ready` tiene que parsear contra el contrato real: eso es lo que
    // convierte "activable" en una promesa y no en una apuesta.
    const contract = await import("@/lib/validation/prevention-module/risk-legal")
    for (const row of rows.filter((item) => item.status === "ready")) {
      expect(contract.riskEntrySchema.omit({ matrixId: true, sourceRowNumber: true, sourceOriginal: true, sourceNormalized: true, normalizationDecision: true }).safeParse(row.normalized).success).toBe(true)
    }

    await importer.resolveRiskImportRow({ rowId: rows[0]!.id, normalized: { ...(rows[0]!.normalized as Record<string, unknown>), residualLevel: "Medio" }, resolution: "El nivel 'Regular' del original se normaliza a Medio según la escala ISP." }, author)
    await importer.approveRiskImportBatch(staged.batch.id, approver)
    // Control positivo: resuelta la observada, TODA fila `ready` se activa.
    expect(await importer.activateRiskImportBatch({ batchId: staged.batch.id, ...activationFields() }, author)).toMatchObject({ completed: true, remaining: 0 })

    // El lote muerto que el archivo por sí solo no delata: el código de proceso
    // "bodega" ya existe en la faena con el nombre "Bodega" (lo creó el lote
    // anterior), y la fila 2 lo redefine, así que `resolveHierarchy` revienta al
    // activar. Antes llegaba como un error anónimo y sin fila.
    const conflicting = await importer.stageRiskImport({
      worksiteId: "ws-risk-b", fileName: "miper_conflicto.xlsx", access: author,
      buffer: await miperWorkbook([
        ["Bodega central", "Ordenar pallets", "Bodeguero", "Peligro que redefine el proceso", "Factor de riesgo", "Lesión", "Bajo", "Bajo", "Jefatura de bodega", "Administrativo: instructivo"],
        ["Patio", "Estacionar equipos", "Portero", "Atropello en patio", "Circulación de equipos", "Lesión grave", "Alto", "Medio", "Jefatura de patio", "Administrativo: instructivo"],
      ], { processCodes: ["bodega", "patio"], hazardCodes: ["RED-01", "ATR-01"] }),
    })
    const conflictingStaged = await getDb().select({ status: schema.preventionRiskImportRows.status }).from(schema.preventionRiskImportRows).where(eq(schema.preventionRiskImportRows.batchId, conflicting.batch.id)).orderBy(asc(schema.preventionRiskImportRows.rowNumber))
    expect(conflictingStaged.map((row) => row.status)).toEqual(["ready", "ready"])
    await importer.approveRiskImportBatch(conflicting.batch.id, approver)
    await expect(importer.activateRiskImportBatch({ batchId: conflicting.batch.id, ...activationFields() }, author))
      .rejects.toThrow(/^Fila 2: /)

    // Y el camino de vuelta: reabrir, rechazar la fila y volver a aprobar.
    const [before] = await getDb().select().from(schema.preventionRiskImportBatches).where(eq(schema.preventionRiskImportBatches.id, conflicting.batch.id))
    expect(before).toMatchObject({ status: "approved", approvedByUserId: "risk-approver" })
    const reopened = await importer.reopenRiskImportBatch({ batchId: conflicting.batch.id, reason: "La fila 3 redefine el código de proceso ya usado en la faena." }, author)
    expect(reopened).toMatchObject({ status: "staged", approvedByUserId: null })
    const conflictingRows = await getDb().select().from(schema.preventionRiskImportRows).where(eq(schema.preventionRiskImportRows.batchId, conflicting.batch.id)).orderBy(asc(schema.preventionRiskImportRows.rowNumber))
    await importer.resolveRiskImportRow({ rowId: conflictingRows[0]!.id, normalized: conflictingRows[0]!.normalized as Record<string, unknown>, resolution: "Se descarta: el código de proceso ya está tomado con otro nombre.", reject: true }, author)
    await importer.approveRiskImportBatch(conflicting.batch.id, approver)
    const activated = await importer.activateRiskImportBatch({ batchId: conflicting.batch.id, ...activationFields() }, author)
    expect(activated).toMatchObject({ completed: true, remaining: 0 })

    // Reabrir sólo quita una aprobación; no la concede ni salta a nadie.
    await expect(importer.reopenRiskImportBatch({ batchId: conflicting.batch.id, reason: "Intento de reabrir un lote ya activado y con matriz creada." }, author))
      .rejects.toThrow(/aprobado y aún sin activar/i)
  })

  /**
   * MIPER-11: `approveRiskImportBatch` acota su UPDATE con `status = 'staged'`,
   * que es el compare-and-swap correcto, pero devolvía `updated!` sin mirar si
   * había actualizado algo. Con dos aprobaciones simultáneas la segunda no
   * tocaba ninguna fila y aun así respondía éxito —con `undefined` disfrazado de
   * lote—, así que la pantalla decía "aprobado" y el aprobador registrado era
   * otro.
   *
   * Se reproduce de verdad, no se simula: bajo READ COMMITTED ambas
   * transacciones leen 'staged' (la lectura no toma lock), la segunda espera en
   * el UPDATE y, al soltarse la primera, reevalúa el predicado sobre la fila ya
   * aprobada y actualiza cero filas.
   */
  it("reports the concurrency error when a second simultaneous approval updates no rows", async () => {
    const importer = await import("@/lib/services/prevention-risk-import")
    const author = accessB("risk-author", ["prevention:risk:view", "prevention:risk:edit"])
    const approver = accessB("risk-approver", ["prevention:risk:approve"])

    const staged = await importer.stageRiskImport({
      worksiteId: "ws-risk-b", fileName: "miper_carrera.xlsx", access: author,
      buffer: await miperWorkbook([
        ["Patio", "Barrer patio", "Auxiliar", "Contacto con polvo", "Material particulado", "Irritación", "Bajo", "Bajo", "Jefatura de patio", "Administrativo: instructivo de aseo"],
      ], { processCodes: ["patio"], hazardCodes: ["POL-01"] }),
    })

    // La aprobación rival ya escribió pero no confirmó: bajo READ COMMITTED la
    // lectura del servicio sigue viendo 'staged' —no toma lock— y es su UPDATE
    // el que queda esperando. El interleaving se fuerza en vez de sortearse para
    // que la prueba caiga SIEMPRE en el cero-filas-actualizadas.
    let release = () => {}
    const holdReleased = new Promise<void>((resolve) => { release = resolve })
    const rival = client!.begin(async (tx) => {
      await tx`UPDATE prevention_risk_import_batches
               SET status = 'approved', approved_by_user_id = 'risk-reviewer', approved_at = now()
               WHERE id = ${staged.batch.id}`
      await holdReleased
    })

    const perdedora = importer.approveRiskImportBatch(staged.batch.id, approver)
      .then(() => null, (error: Error) => error)

    await new Promise((resolve) => setTimeout(resolve, 250))
    release()
    await rival

    const outcome = await perdedora
    expect(outcome).toBeInstanceOf(Error)
    expect(outcome?.message).toBe("El lote cambió mientras lo aprobabas. Recarga antes de continuar.")

    // Y el lote quedó aprobado UNA vez, por quien efectivamente escribió: antes
    // la perdedora respondía éxito y dejaba creer que el aprobador era ella.
    const [batch] = await getDb().select().from(schema.preventionRiskImportBatches)
      .where(eq(schema.preventionRiskImportBatches.id, staged.batch.id))
    expect(batch).toMatchObject({ status: "approved", approvedByUserId: "risk-reviewer" })
  })

  // LEGAL-02: dos versiones publicadas del mismo código son dos obligaciones
  // contradictorias vigentes. Va al final del archivo porque supera al requisito
  // que las pruebas anteriores dejan vigente y usan como fuente PDTP.
  it("admits a single published version per legal code and supersedes the previous one in the same transaction", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const author = access("risk-author", ["prevention:legal:view", "prevention:legal:assess"])
    const reviewer = access("risk-reviewer", ["prevention:legal:assess"])
    const approver = access("risk-approver", ["prevention:legal:approve_applicability"])
    const [current] = await getDb().select().from(schema.preventionLegalRequirements).where(eq(schema.preventionLegalRequirements.id, legalRequirementId))
    expect(current).toMatchObject({ code: "DS44-ART7", status: "published" })

    // El índice parcial es la red: ni una escritura directa que se salte el
    // servicio puede dejar dos textos vigentes para el mismo artículo.
    // Drizzle envuelve el error de Postgres en "Failed query"; el nombre del
    // índice viaja en `cause`, y es lo único que prueba cuál constraint saltó.
    const duplicate = await getDb().insert(schema.preventionLegalRequirements).values({
      id: "legalreq-duplicado", code: "DS44-ART7", requirementVersion: 99, sourceType: "regulatory", authority: "Ministerio del Trabajo",
      sourceTitle: "Decreto Supremo N°44", sourceReference: "DS 44/2024", article: "Artículo 7", requirement: "Texto paralelo que contradice al vigente.",
      versionLabel: "Paralela", validFrom: "2026-01-01", topic: "MIPER", chomeRole: "Entidad empleadora", evidenceRequired: "Ninguna", frequency: "Anual",
      status: "published", createdByUserId: "risk-author", reviewedByUserId: "risk-reviewer", approvedByUserId: "risk-approver",
    }).then(() => null, (error: Error) => error)
    expect(String((duplicate as (Error & { cause?: unknown }) | null)?.cause)).toMatch(/prevention_legal_requirements_one_published_code_unique/)

    // La v3 se crea SIN `sourceRequirementId` —es lo único que envía el
    // formulario— y aun así tiene que superar a la vigente. Que la publicación
    // no choque contra el índice prueba que ambas cosas ocurren en la misma
    // transacción: si la supersesión fuera posterior, este publish fallaría.
    const v3 = await service.createLegalRequirementDraft({
      code: "DS44-ART7", sourceType: "regulatory", authority: "Ministerio del Trabajo",
      sourceTitle: "Decreto Supremo N°44", sourceReference: "DS 44/2024", article: "Artículo 7",
      requirement: "Confeccionar, revisar y mantener trazable la matriz, incorporando la actualización normativa de 2026.",
      versionLabel: "Actualización 2026", validFrom: "2026-03-01", topic: "MIPER", chomeRole: "Entidad empleadora",
      evidenceRequired: "MIPER publicada, participación e historial de revisión", frequency: "Anual y por disparador",
    }, author)
    expect(v3.supersedesRequirementId).toBeNull()
    const v3Submitted = await service.transitionLegalRequirement({ requirementId: v3.id, expectedVersion: v3.version, toStatus: "in_review", reason: "Actualización 2026 enviada a revisión normativa." }, author)
    const v3Reviewed = await service.transitionLegalRequirement({ requirementId: v3.id, expectedVersion: v3Submitted.version, toStatus: "reviewed", reason: "Redacción y fuente oficial contrastadas nuevamente." }, reviewer)
    const v3Approved = await service.transitionLegalRequirement({ requirementId: v3.id, expectedVersion: v3Reviewed.version, toStatus: "approved", reason: "Actualización aprobada por rol segregado." }, approver)
    const v3Published = await service.transitionLegalRequirement({ requirementId: v3.id, expectedVersion: v3Approved.version, toStatus: "published", reason: "Publicación de la versión 2026 del requisito." }, approver)

    expect(v3Published).toMatchObject({ status: "published", supersedesRequirementId: current!.id })
    const [replaced] = await getDb().select().from(schema.preventionLegalRequirements).where(eq(schema.preventionLegalRequirements.id, current!.id))
    // `validTo` es el ÚLTIMO día en que rigió el texto anterior, o sea el previo a
    // la entrada en vigor de su reemplazo (`validFrom: "2026-03-01"`). Cerrarlo en
    // la misma fecha dejaba a las dos versiones vigentes ese día e impedía
    // reconstruir qué texto regía en una fecha dada.
    expect(replaced).toMatchObject({ status: "superseded", validTo: "2026-02-28", version: current!.version + 1 })
    const stillPublished = await getDb().select({ id: schema.preventionLegalRequirements.id }).from(schema.preventionLegalRequirements).where(and(
      eq(schema.preventionLegalRequirements.code, "DS44-ART7"),
      eq(schema.preventionLegalRequirements.status, "published"),
    ))
    expect(stillPublished).toEqual([{ id: v3.id }])
    const [supersededHistory] = await getDb().select().from(schema.preventionRiskLegalHistory).where(and(
      eq(schema.preventionRiskLegalHistory.entityId, current!.id),
      eq(schema.preventionRiskLegalHistory.changeType, "superseded"),
    ))
    expect(supersededHistory).toMatchObject({
      domain: "legal",
      beforeState: expect.objectContaining({ status: "published", validTo: null }),
      afterState: expect.objectContaining({ status: "superseded", validTo: "2026-02-28", supersededByRequirementId: v3.id }),
    })
  })

  /**
   * LEGAL-07: `supersedes_requirement_id` es el registro de qué se reemplazó,
   * no el control (el control es la supersesión por código). Como registro
   * tiene que ser cierto: FK para que apunte a un requisito que existe, y
   * recálculo al publicar para que no afirme una supersesión que no ocurrió.
   */
  it("keeps the supersession link honest: foreign key and recalculation at publish time", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const author = access("risk-author", ["prevention:legal:view", "prevention:legal:assess"])
    const reviewer = access("risk-reviewer", ["prevention:legal:assess"])
    const approver = access("risk-approver", ["prevention:legal:approve_applicability"])
    const [current] = await getDb().select().from(schema.preventionLegalRequirements).where(and(
      eq(schema.preventionLegalRequirements.code, "DS44-ART7"),
      eq(schema.preventionLegalRequirements.status, "published"),
    ))

    // Sin FK la columna admitía cualquier texto: un enlace a un requisito que
    // no existe es una derogación inventada dentro del registro legal.
    const dangling = await getDb().insert(schema.preventionLegalRequirements).values({
      id: "legalreq-colgado", code: "DS44-ART99", requirementVersion: 1, sourceType: "regulatory", authority: "Ministerio del Trabajo",
      sourceTitle: "Decreto Supremo N°44", sourceReference: "DS 44/2024", article: "Artículo 99", requirement: "Texto que dice reemplazar a un requisito inexistente.",
      versionLabel: "Colgada", validFrom: "2026-04-01", topic: "MIPER", chomeRole: "Entidad empleadora", evidenceRequired: "Ninguna", frequency: "Anual",
      supersedesRequirementId: "legalreq-que-no-existe", createdByUserId: "risk-author",
    }).then(() => null, (error: Error) => error)
    expect(String((dangling as (Error & { cause?: unknown }) | null)?.cause)).toMatch(/prevention_legal_requirements_supersedes_requirement_id/)

    // Enlace explícito válido: se acepta y es el control positivo de la FK.
    const stale = await service.createLegalRequirementDraft({
      code: "DS44-ART7", sourceRequirementId: current!.id, sourceType: "regulatory", authority: "Ministerio del Trabajo",
      sourceTitle: "Decreto Supremo N°44", sourceReference: "DS 44/2024", article: "Artículo 7",
      requirement: "Borrador preparado contra la versión vigente al momento de redactarlo, publicado más tarde.",
      versionLabel: "Borrador rezagado", validFrom: "2026-05-01", topic: "MIPER", chomeRole: "Entidad empleadora",
      evidenceRequired: "MIPER publicada e historial de revisión", frequency: "Anual",
    }, author)
    expect(stale.supersedesRequirementId).toBe(current!.id)

    // Entremedio se publica otra versión, que es la que de verdad supera a la
    // vigente: el borrador rezagado ya no reemplaza a quien creía reemplazar.
    const overtaking = await publishRequirement(service, {
      code: "DS44-ART7", requirement: "Versión que se adelanta al borrador rezagado y pasa a ser la vigente.",
      versionLabel: "Adelantada 2026", validFrom: "2026-04-15",
    }, { author, reviewer, approver })
    expect(overtaking.supersedesRequirementId).toBe(current!.id)

    const staleSubmitted = await service.transitionLegalRequirement({ requirementId: stale.id, expectedVersion: stale.version, toStatus: "in_review", reason: "Borrador rezagado enviado a revisión normativa." }, author)
    const staleReviewed = await service.transitionLegalRequirement({ requirementId: stale.id, expectedVersion: staleSubmitted.version, toStatus: "reviewed", reason: "Redacción del borrador rezagado contrastada." }, reviewer)
    const staleApproved = await service.transitionLegalRequirement({ requirementId: stale.id, expectedVersion: staleReviewed.version, toStatus: "approved", reason: "Borrador rezagado aprobado por rol segregado." }, approver)
    const stalePublished = await service.transitionLegalRequirement({ requirementId: stale.id, expectedVersion: staleApproved.version, toStatus: "published", reason: "Publicación del borrador rezagado." }, approver)

    // El enlace del borrador no sobrevive: apuntaba a un requisito que ya
    // estaba superado, y quien realmente quedó reemplazado es el adelantado.
    expect(stalePublished.supersedesRequirementId).toBe(overtaking.id)
    expect(stalePublished.supersedesRequirementId).not.toBe(current!.id)
  })

  /* ── Fase 6 · vigencia efectiva ─────────────────────────────────────────────
   * El registro guardaba estado y fechas de vigencia que ninguna consulta
   * usaba: el tablero de cumplimiento medía contra textos derogados. */

  // LEGAL-01: publicada la v2, la aplicabilidad de la v1 seguía contando como
  // aplicable y como brecha.
  it("drops the previous version's applicability from applicables and gaps when the amended version is published", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const actors = legalActors()
    const viewer = access("risk-viewer", ["prevention:legal:view"])

    const v1 = await publishRequirement(service, {
      code: "DS44-ART31", requirement: "Mantener el programa de trabajo preventivo con las medidas comprometidas.",
      versionLabel: "Original", validFrom: "2025-01-01",
    }, actors)
    const proposed = await service.proposeLegalApplicability({
      requirementId: v1.id, worksiteId: "ws-risk-a", applicabilityStatus: "proposed_applicable",
      rationale: "La faena ejecuta el proceso que la obligación alcanza y tiene personal expuesto.",
      responsibleSnapshot: "Jefatura de prevención",
    }, actors.author)
    const approved = await service.approveLegalApplicability({ applicabilityId: proposed.id, expectedVersion: proposed.version, reason: "Aplicabilidad contrastada con la operación vigente." }, actors.approver)
    // Una propuesta que queda pendiente mientras se publica la enmienda: nadie
    // debe poder firmarla después contra el texto que ya no rige.
    const bothSites = legalActors(["ws-risk-a", "ws-risk-b"])
    const pending = await service.proposeLegalApplicability({
      requirementId: v1.id, worksiteId: "ws-risk-b", applicabilityStatus: "proposed_applicable",
      rationale: "La faena sur también ejecuta el proceso alcanzado por la obligación.",
      responsibleSnapshot: "Prevención corporativa",
    }, bothSites.author)

    const before = await service.getLegalDashboard(viewer)
    expect(before.applicabilities.find((row) => row.applicability.id === proposed.id)).toMatchObject({ inForce: true, gapReason: "Sin evaluar" })
    expect(before.gaps.map((row) => row.applicability.id)).toContain(proposed.id)

    const v2 = await publishRequirement(service, {
      code: "DS44-ART31", requirement: "Mantener el programa de trabajo preventivo, ahora con verificación semestral de las medidas.",
      versionLabel: "Enmienda 2026", validFrom: "2026-06-01",
    }, actors)
    const after = await service.getLegalDashboard(viewer)
    expect(after.applicabilities.find((row) => row.applicability.id === proposed.id)).toMatchObject({ inForce: false, gapReason: null })
    expect(after.gaps.map((row) => row.applicability.id)).not.toContain(proposed.id)
    expect(after.counts.applicable).toBe(before.counts.applicable - 1)
    expect(after.counts.gaps).toBe(before.counts.gaps - 1)
    expect(after.counts.superseded).toBe(before.counts.superseded + 1)

    // No se migra ni se reescribe: la decisión y su firma se dieron sobre el
    // texto de la v1 y ahí se quedan. Lo que cambia es que deja de contar.
    const [row] = await getDb().select().from(schema.preventionLegalApplicabilities).where(eq(schema.preventionLegalApplicabilities.id, proposed.id))
    expect(row).toMatchObject({ requirementId: v1.id, applicabilityStatus: "applicable", version: approved.version })
    const [orphanHistory] = await getDb().select().from(schema.preventionRiskLegalHistory).where(and(
      eq(schema.preventionRiskLegalHistory.entityId, proposed.id),
      eq(schema.preventionRiskLegalHistory.changeType, "superseded"),
    ))
    expect(orphanHistory).toMatchObject({ domain: "legal", afterState: { supersededByRequirementId: v2.id } })
    expect(orphanHistory!.reason).toMatch(/re-evaluarse/i)

    await expect(service.approveLegalApplicability({
      applicabilityId: pending.id, expectedVersion: pending.version,
      reason: "Intento de firmar una decisión sobre el texto que la enmienda reemplazó.",
    }, bothSites.approver)).rejects.toThrow(/dejó de estar vigente/i)
  })

  // LEGAL-03: `valid_from`/`valid_to` eran decorativos — un requisito con la
  // vigencia terminada seguía contando como vigente y admitía evaluaciones.
  it("stops counting a requirement whose validity window has ended, and refuses to assess against it", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const actors = legalActors()
    const viewer = access("risk-viewer", ["prevention:legal:view"])

    const requirement = await publishRequirement(service, {
      code: "LEY16744-ART66", requirement: "Mantener el comité paritario constituido conforme al texto entonces vigente.",
      versionLabel: "Texto con vigencia acotada", validFrom: "2025-01-01", validTo: "2027-12-31",
    }, actors)
    const proposed = await service.proposeLegalApplicability({
      requirementId: requirement.id, worksiteId: "ws-risk-a", applicabilityStatus: "proposed_applicable",
      rationale: "La faena supera el umbral de personas trabajadoras que exige el comité.",
      responsibleSnapshot: "Jefatura de prevención",
    }, actors.author)
    const approved = await service.approveLegalApplicability({ applicabilityId: proposed.id, expectedVersion: proposed.version, reason: "Umbral de dotación verificado en la faena." }, actors.approver)

    // Control positivo: dentro de su ventana cuenta como cualquier otra.
    const before = await service.getLegalDashboard(viewer)
    expect(before.requirements.find((item) => item.id === requirement.id)).toMatchObject({ status: "published", inForce: true })
    expect(before.gaps.map((row) => row.applicability.id)).toContain(proposed.id)

    // Pasa la fecha de término (sin reemplazo: el estado sigue en 'published',
    // que es justo el caso que ninguna consulta miraba).
    await getDb().update(schema.preventionLegalRequirements).set({ validTo: "2026-01-31" }).where(eq(schema.preventionLegalRequirements.id, requirement.id))
    const after = await service.getLegalDashboard(viewer)
    expect(after.requirements.find((item) => item.id === requirement.id)).toMatchObject({ status: "published", inForce: false })
    expect(after.applicabilities.find((row) => row.applicability.id === proposed.id)).toMatchObject({ inForce: false, gapReason: null })
    expect(after.gaps.map((row) => row.applicability.id)).not.toContain(proposed.id)
    expect(after.counts.applicable).toBe(before.counts.applicable - 1)
    expect(after.counts.requirementsInForce).toBe(before.counts.requirementsInForce - 1)

    await expect(service.assessLegalCompliance({
      applicabilityId: proposed.id, expectedVersion: approved.version, status: "compliant",
      evidenceReference: "acta-constitucion-cphs-2026",
    }, actors.author)).rejects.toThrow(/no está vigente/i)
    await expect(service.proposeLegalApplicability({
      requirementId: requirement.id, worksiteId: "ws-risk-b", applicabilityStatus: "proposed_applicable",
      rationale: "Intento de pronunciarse sobre un texto cuya vigencia ya terminó.",
      responsibleSnapshot: "Prevención corporativa",
    }, legalActors(["ws-risk-b"]).author)).rejects.toThrow(/no vigente/i)
  })

  // LEGAL-04: con proceso nulo —lo que envía el formulario por defecto— el
  // índice único no restringía nada, porque en SQL NULL != NULL.
  it("admits a single applicability per requirement and worksite when the process is null, even under concurrency", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const actors = legalActors()
    const requirement = await publishRequirement(service, {
      code: "DS44-ART21", requirement: "Informar los riesgos laborales a cada persona trabajadora al ingresar.",
      versionLabel: "Vigente", validFrom: "2025-01-01",
    }, actors)

    const competing = await Promise.allSettled([
      service.proposeLegalApplicability({
        requirementId: requirement.id, worksiteId: "ws-risk-a", applicabilityStatus: "proposed_applicable",
        rationale: "Primera propuesta concurrente sobre toda la faena, sin proceso acotado.",
        responsibleSnapshot: "Jefatura de prevención",
      }, actors.author),
      service.proposeLegalApplicability({
        requirementId: requirement.id, worksiteId: "ws-risk-a", applicabilityStatus: "proposed_not_applicable",
        rationale: "Segunda propuesta concurrente que contradice a la primera sobre la misma faena.",
        responsibleSnapshot: "Prevención corporativa",
      }, actors.author),
    ])
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(competing.filter((result) => result.status === "rejected")).toHaveLength(1)
    const rows = await getDb().select().from(schema.preventionLegalApplicabilities).where(and(
      eq(schema.preventionLegalApplicabilities.requirementId, requirement.id),
      isNull(schema.preventionLegalApplicabilities.processId),
    ))
    expect(rows).toHaveLength(1)

    // Y el índice no rompe el camino normal: volver a pronunciarse sobre la
    // misma faena sigue actualizando la misma fila, no creando otra.
    const again = await service.proposeLegalApplicability({
      requirementId: requirement.id, worksiteId: "ws-risk-a", applicabilityStatus: "proposed_applicable",
      rationale: "Corrección del fundamento tras revisar la dotación real de la faena.",
      responsibleSnapshot: "Jefatura de prevención",
    }, actors.author)
    expect(again.id).toBe(rows[0]!.id)
    expect(again.version).toBe(rows[0]!.version + 1)
  })

  // LEGAL-05 y LEGAL-06: la brecha se declaraba cumplida con su CAPA todavía
  // abierta, y la fecha de re-evaluación no tenía efecto alguno.
  it("refuses to declare compliance while the CAPA is open, and re-opens the gap when the re-assessment date passes", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const actors = legalActors()
    const assessor = access("risk-author", ["prevention:legal:view", "prevention:legal:assess", "prevention:capa:manage"])
    const viewer = access("risk-viewer", ["prevention:legal:view"])
    const requirement = await publishRequirement(service, {
      code: "DS44-ART22", requirement: "Ejecutar el programa de trabajo preventivo y mantener evidencia de cada actividad.",
      versionLabel: "Vigente", validFrom: "2025-01-01",
    }, actors)
    const proposed = await service.proposeLegalApplicability({
      requirementId: requirement.id, worksiteId: "ws-risk-a", applicabilityStatus: "proposed_applicable",
      rationale: "La faena ejecuta actividades del programa y debe acreditar su cumplimiento.",
      responsibleSnapshot: "Jefatura de prevención",
    }, actors.author)
    const approved = await service.approveLegalApplicability({ applicabilityId: proposed.id, expectedVersion: proposed.version, reason: "Aplicabilidad confirmada contra el programa vigente." }, actors.approver)

    const gap = await service.assessLegalCompliance({
      applicabilityId: proposed.id, expectedVersion: approved.version, status: "noncompliant",
      finding: "Faltan las evidencias de tres actividades del programa del semestre.",
      capa: { actionDescription: "Levantar y archivar la evidencia faltante de las tres actividades.", responsibleSnapshot: "Jefatura de prevención", targetDate: "2026-09-30", priority: "high" },
    }, assessor)
    const capaId = gap.assessment.capaActionId!
    expect(capaId).toBeTruthy()

    const compliant = {
      applicabilityId: proposed.id, expectedVersion: gap.applicability.version, status: "compliant" as const,
      evidenceReference: "carpeta-evidencias-programa-2026",
    }
    await expect(service.assessLegalCompliance(compliant, assessor)).rejects.toThrow(/sigue abierta/i)
    const [untouched] = await getDb().select().from(schema.preventionLegalApplicabilities).where(eq(schema.preventionLegalApplicabilities.id, proposed.id))
    expect(untouched).toMatchObject({ complianceStatus: "noncompliant", version: gap.applicability.version })

    // Verificada la acción —el acto que acredita la corrección con evidencia y
    // actor segregado—, el cumplimiento sí se puede declarar. Se marca directo
    // para no arrastrar acá la máquina completa de CAPA, que tiene su propia
    // suite.
    await getDb().update(schema.preventionCapaActions).set({ status: "verified" }).where(eq(schema.preventionCapaActions.id, capaId))
    const closed = await service.assessLegalCompliance({ ...compliant, nextAssessmentAt: "2027-06-30" }, assessor)
    expect(closed.applicability).toMatchObject({ complianceStatus: "compliant" })
    const withFutureDate = await service.getLegalDashboard(viewer)
    expect(withFutureDate.applicabilities.find((row) => row.applicability.id === proposed.id)?.gapReason).toBeNull()
    expect(withFutureDate.gaps.map((row) => row.applicability.id)).not.toContain(proposed.id)

    // LEGAL-06: la misma fila, con la re-evaluación comprometida ya vencida,
    // vuelve a ser brecha aunque el estado almacenado siga siendo 'compliant'.
    await service.assessLegalCompliance({ ...compliant, expectedVersion: closed.applicability.version, nextAssessmentAt: "2026-01-15" }, assessor)
    const withPastDate = await service.getLegalDashboard(viewer)
    const row = withPastDate.applicabilities.find((item) => item.applicability.id === proposed.id)
    expect(row?.applicability.complianceStatus).toBe("compliant")
    expect(row?.gapReason).toMatch(/re-evaluación vencida el 15-01-2026/i)
    expect(withPastDate.gaps.map((item) => item.applicability.id)).toContain(proposed.id)
    expect(withPastDate.counts.compliant).toBe(withFutureDate.counts.compliant - 1)
  })

  /* LEGAL-06 tiene DOS relojes y sólo el de la re-evaluación estaba afirmado:
   * `evidenceDueAt` se sembraba en otras pruebas pero nadie comprobaba que
   * vencido abriera brecha, así que borrar esa línea del servicio no habría
   * puesto ningún test en rojo. Va en su propio `it` con una aplicabilidad
   * aparte para que la fecha de re-evaluación quede en el futuro y el motivo
   * que se afirma sea inequívocamente el de la evidencia. */
  it("re-opens the gap when the evidence deadline passed, even with the re-assessment date still ahead", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const actors = legalActors()
    const assessor = access("risk-author", ["prevention:legal:view", "prevention:legal:assess", "prevention:capa:manage"])
    const viewer = access("risk-viewer", ["prevention:legal:view"])
    const requirement = await publishRequirement(service, {
      code: "DS44-ART41", requirement: "Mantener disponible la evidencia de cada obligación declarada cumplida.",
      versionLabel: "Vigente", validFrom: "2025-01-01",
    }, actors)
    const proposed = await service.proposeLegalApplicability({
      requirementId: requirement.id, worksiteId: "ws-risk-a", applicabilityStatus: "proposed_applicable",
      rationale: "La faena declara cumplimiento y compromete la evidencia con plazo.",
      responsibleSnapshot: "Jefatura de prevención",
      // Plazo de evidencia ya vencido y fijo: no depende del día en que corra.
      evidenceDueAt: "2025-03-31",
    }, actors.author)
    const approved = await service.approveLegalApplicability({
      applicabilityId: proposed.id, expectedVersion: proposed.version,
      reason: "Aplicabilidad confirmada contra la operación vigente de la faena.",
    }, actors.approver)

    const closed = await service.assessLegalCompliance({
      applicabilityId: proposed.id, expectedVersion: approved.version, status: "compliant",
      evidenceReference: "carpeta-evidencias-2025",
      nextAssessmentAt: "2027-06-30",
    }, assessor)
    expect(closed.applicability).toMatchObject({ complianceStatus: "compliant" })

    const dashboard = await service.getLegalDashboard(viewer)
    const row = dashboard.applicabilities.find((item) => item.applicability.id === proposed.id)
    // La fila está declarada cumplida y con re-evaluación al 2027: lo único
    // vencido es la evidencia, y eso basta para que sea brecha.
    expect(row?.applicability.complianceStatus).toBe("compliant")
    expect(row?.gapReason).toMatch(/evidencia vencida el 31-03-2025/i)
    expect(dashboard.gaps.map((item) => item.applicability.id)).toContain(proposed.id)
  })
})

/** Recorre borrador → publicado, que es lo único que interesa de esos 4 pasos. */
async function publishRequirement(
  service: typeof import("@/lib/services/prevention-risk-legal"),
  fields: { code: string; requirement: string; versionLabel: string; validFrom: string; validTo?: string },
  actors: { author: ReturnType<typeof access>; reviewer: ReturnType<typeof access>; approver: ReturnType<typeof access> },
) {
  const draft = await service.createLegalRequirementDraft({
    ...fields, sourceType: "regulatory", authority: "Ministerio del Trabajo",
    sourceTitle: "Decreto Supremo N°44", sourceReference: "DS 44/2024", article: "Artículo 7",
    topic: "MIPER", chomeRole: "Entidad empleadora", evidenceRequired: "MIPER publicada e historial de revisión", frequency: "Anual",
  }, actors.author)
  const submitted = await service.transitionLegalRequirement({ requirementId: draft.id, expectedVersion: draft.version, toStatus: "in_review", reason: `Envío a revisión de ${fields.versionLabel}.` }, actors.author)
  const reviewed = await service.transitionLegalRequirement({ requirementId: draft.id, expectedVersion: submitted.version, toStatus: "reviewed", reason: `Revisión normativa de ${fields.versionLabel}.` }, actors.reviewer)
  const approved = await service.transitionLegalRequirement({ requirementId: draft.id, expectedVersion: reviewed.version, toStatus: "approved", reason: `Aprobación segregada de ${fields.versionLabel}.` }, actors.approver)
  return service.transitionLegalRequirement({ requirementId: draft.id, expectedVersion: approved.version, toStatus: "published", reason: `Publicación de ${fields.versionLabel}.` }, actors.approver)
}

function access(userId: string, permissions: string[], ids: string[] = ["ws-risk-a"]) {
  return { userId, scope: { mode: "some" as const, ids }, permissions }
}

/** Los tres roles segregados del circuito legal, que es lo único que cambia. */
function legalActors(ids: string[] = ["ws-risk-a"]) {
  return {
    author: access("risk-author", ["prevention:legal:view", "prevention:legal:assess"], ids),
    reviewer: access("risk-reviewer", ["prevention:legal:assess"], ids),
    approver: access("risk-approver", ["prevention:legal:view", "prevention:legal:approve_applicability"], ids),
  }
}

/* Fase 4 · MIPER trabaja sobre ws-risk-b para no reemplazar la matriz vigente de
 * ws-risk-a, de la que dependen las pruebas de cobertura PDTP anteriores. */
function accessB(userId: string, permissions: string[]) {
  return access(userId, permissions, ["ws-risk-b"])
}

function matrixDraft(title: string, sourceMatrixId?: string) {
  return {
    worksiteId: "ws-risk-b", title, methodologyId, sourceMatrixId,
    revisionReason: "Confección de la matriz de la faena sur conforme al DS 44.",
    participationSummary: "Taller participativo con la línea de mando y las personas trabajadoras.",
    consultationEvidenceReference: `acta-participacion-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  }
}

function riskEntryB(matrixId: string, args: { hazardCode: string; hazard: string; critical: boolean; controls: Array<Record<string, unknown>> }) {
  return { ...riskEntry(matrixId, args), process: { code: "PROC-B", name: "Operación planta sur" }, task: { code: "TASK-B", name: "Operar cinta", isRoutine: true }, position: { code: "POS-B", name: "Operador de planta" } }
}

/** Borrador → publicada en ws-risk-b, que es lo único que interesa de los 4 pasos. */
async function publishMatrixB(
  service: typeof import("@/lib/services/prevention-risk-legal"),
  title: string,
  entries: Array<{ hazardCode: string; hazard: string; critical: boolean; controls: Array<Record<string, unknown>> }>,
  sourceMatrixId?: string,
) {
  const author = accessB("risk-author", ["prevention:risk:view", "prevention:risk:edit"])
  const reviewer = accessB("risk-reviewer", ["prevention:risk:review"])
  const approver = accessB("risk-approver", ["prevention:risk:approve"])
  const publisher = accessB("risk-publisher", ["prevention:risk:publish"])
  const draft = await service.createRiskMatrixDraft(matrixDraft(title, sourceMatrixId), author)
  for (const entry of entries) await service.addRiskEntry(riskEntryB(draft.id, entry), author)
  const submitted = await service.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: draft.version, toStatus: "in_review", reason: `Envío a revisión de ${title}.` }, author)
  const reviewed = await service.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: submitted.version, toStatus: "reviewed", reason: `Revisión técnica de ${title}.` }, reviewer)
  const approved = await service.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: reviewed.version, toStatus: "approved", reason: `Aprobación segregada de ${title}.` }, approver)
  return service.transitionRiskMatrix({ matrixId: draft.id, expectedVersion: approved.version, toStatus: "published", reason: `Publicación de ${title}.` }, publisher)
}

/** `methodologyId` se resuelve en la primera prueba, así que esto es función. */
function activationFields() {
  return {
    title: "MIPER importada faena sur",
    methodologyId,
    revisionReason: "Migración controlada de la planilla histórica de la faena sur.",
    participationSummary: "Normalización revisada con responsables de proceso y prevención.",
    consultationEvidenceReference: "acta-importacion-miper-sur",
  }
}

/** Excel MIPER mínimo con las columnas obligatorias del importador. */
async function miperWorkbook(rows: string[][], opts?: { processCodes?: string[]; hazardCodes?: string[] }) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("MIPER")
  sheet.addRow(["Proceso", "Tarea", "Puesto de trabajo", "Peligro", "Factor de riesgo", "Evento o daño", "Nivel inherente", "Nivel residual", "Responsable", "Controles", "Código proceso", "Código peligro"])
  rows.forEach((row, index) => sheet.addRow([...row, opts?.processCodes?.[index] ?? "", opts?.hazardCodes?.[index] ?? ""]))
  return Buffer.from(await workbook.xlsx.writeBuffer())
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
    { id: "risk-publisher", name: "Publicador", email: "risk-publisher@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "risk-viewer", name: "Lector", email: "risk-viewer@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "risk-outsider", name: "Ajeno", email: "risk-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
  // Comités y sesiones para MIPER-07. La sesión cuelga del comité y el comité
  // de la faena: el vínculo faena↔sesión sólo existe a través de esa cadena.
  await database.insert(schema.preventionCommittees).values([
    { id: "cphs-risk-a", worksiteId: "ws-risk-a", name: "CPHS Faena Norte", constitutedOn: "2026-01-02", mandateEndsOn: "2028-01-02", createdByUserId: "risk-author", createdAt: now, updatedAt: now },
    { id: "cphs-risk-b", worksiteId: "ws-risk-b", name: "CPHS Faena Sur", constitutedOn: "2026-01-02", mandateEndsOn: "2028-01-02", createdByUserId: "risk-author", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.preventionCommitteeMeetings).values([
    { id: "cphs-meet-a", code: "CPHS-A-001", committeeId: "cphs-risk-a", scheduledFor: now, agenda: "Revisión participativa de la MIPER.", status: "scheduled", createdByUserId: "risk-author", createdAt: now, updatedAt: now },
    { id: "cphs-meet-a-cancelled", code: "CPHS-A-002", committeeId: "cphs-risk-a", scheduledFor: now, agenda: "Sesión suspendida.", status: "cancelled", cancellationReason: "Sin quórum en la fecha convocada.", createdByUserId: "risk-author", createdAt: now, updatedAt: now },
    { id: "cphs-meet-b", code: "CPHS-B-001", committeeId: "cphs-risk-b", scheduledFor: now, agenda: "Sesión del comité de otra faena.", status: "scheduled", createdByUserId: "risk-author", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.pdtpPrograms).values({ id: "pdtp-risk-program", year: 2026, version: 1, status: "active", title: "PDTP pruebas P0-05", elaboratedByUserId: "risk-author", elaboratedByName: "Autor", elaboratedByTitle: "Prevencionista", createdAt: now, updatedAt: now })
  await database.insert(schema.pdtpActivities).values([
    { id: "pdtp-risk-activity", programId: "pdtp-risk-program", n: 1, activity: "Verificar control de ingeniería", program: "MIPER", responsibleSlugs: ["prevencion"], responsibleDisplay: "Prevención", sourceSheetRow: 1, createdAt: now, updatedAt: now },
    { id: "pdtp-legal-activity", programId: "pdtp-risk-program", n: 2, activity: "Revisar evidencia legal", program: "Legal", responsibleSlugs: ["prevencion"], responsibleDisplay: "Prevención", sourceSheetRow: 2, createdAt: now, updatedAt: now },
    { id: "pdtp-unsourced-activity", programId: "pdtp-risk-program", n: 3, activity: "Actividad aún no conciliada", program: "Interno", responsibleSlugs: ["prevencion"], responsibleDisplay: "Prevención", sourceSheetRow: 3, createdAt: now, updatedAt: now },
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

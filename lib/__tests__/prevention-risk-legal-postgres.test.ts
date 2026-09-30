/** Real PostgreSQL proof for the legal register and its effective validity. */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import postgres from "postgres"
import { and, eq, isNull, sql } from "drizzle-orm"
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
import { readModuleHistory } from "@/lib/testing/audit-history"

const databaseUrl = process.env.PREVENTION_RISK_DATABASE_URL
const canReset = process.env.PREVENTION_RISK_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
const previousStoragePath = process.env.STORAGE_PATH
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined
let storagePath = ""
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

  it("enforces scoped legal applicability, approval rationale and CAPA for gaps", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const author = access("risk-author", ["prevention:legal:view", "prevention:legal:assess", "prevention:capa:manage"], ["ws-risk-a", "ws-risk-b"])
    const reviewer = access("risk-reviewer", ["prevention:legal:assess"], ["ws-risk-a", "ws-risk-b"])
    const approver = access("risk-approver", ["prevention:legal:approve_applicability"], ["ws-risk-a", "ws-risk-b"])
    const publisher = access("risk-publisher", ["prevention:legal:approve_applicability"], ["ws-risk-a", "ws-risk-b"])
    const requirement = await service.createLegalRequirementDraft({
      code: "DS44-ART7", sourceType: "regulatory", authority: "Ministerio del Trabajo", sourceTitle: "Decreto Supremo N°44", sourceReference: "DS 44/2024", sourceUrl: "https://www.bcn.cl/leychile/navegar?idNorma=1205298", article: "Artículo 7", requirement: "Confeccionar y revisar una matriz de identificación de peligros y evaluación de riesgos por procesos, tareas y puestos.", versionLabel: "Vigente desde 2025-02-01", validFrom: "2025-02-01", topic: "MIPER", chomeRole: "Entidad empleadora", evidenceRequired: "MIPER publicada, participación y evidencia de revisión", frequency: "Anual y por disparador",
    }, author)
    legalRequirementId = requirement.id
    const submitted = await service.transitionLegalRequirement({ requirementId: requirement.id, expectedVersion: requirement.version, toStatus: "in_review", reason: "Requisito enviado a revisión normativa independiente." }, author)
    const reviewed = await service.transitionLegalRequirement({ requirementId: requirement.id, expectedVersion: submitted.version, toStatus: "reviewed", reason: "Fuente oficial y granularidad del requisito verificadas." }, reviewer)
    const approved = await service.transitionLegalRequirement({ requirementId: requirement.id, expectedVersion: reviewed.version, toStatus: "approved", reason: "Requisito aprobado para incorporar al registro legal." }, approver)
    /* D4: publicar es la cuarta firma, como en la MIPER. Quien aprobó el
     * requisito no puede publicarlo él mismo: con el mismo permiso cubriendo
     * los dos pasos, la segregación dependía sólo de que nadie lo intentara. */
    const selfPublish = service.transitionLegalRequirement({ requirementId: requirement.id, expectedVersion: approved.version, toStatus: "published", reason: "Quien aprobó intenta publicar el requisito." }, approver)
    await expect(selfPublish).rejects.toThrow(/no puede publicarlo/i)
    await expect(selfPublish).rejects.toBeInstanceOf(service.RiskLegalDomainError)
    const published = await service.transitionLegalRequirement({ requirementId: requirement.id, expectedVersion: approved.version, toStatus: "published", reason: "Publicación formal del requisito y su versión vigente." }, publisher)
    expect(published.publishedByUserId).toBe("risk-publisher")
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
    const revisionPublished = await service.transitionLegalRequirement({ requirementId: revision.id, expectedVersion: revisionApproved.version, toStatus: "published", reason: "Nueva versión del requisito publicada sin sobrescribir evidencia." }, publisher)
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
    const [legalSupersededHistory] = await readModuleHistory(getDb(), {
      module: "risk_legal:legal", entityType: "requirement", entityId: requirement.id, changeType: "superseded",
    })
    expect(legalSupersededHistory).toMatchObject({
      beforeState: expect.objectContaining({ status: "published", publishedHashSha256: published.publishedHashSha256 }),
      afterState: expect.objectContaining({ status: "superseded", supersededByRequirementId: revision.id }),
    })
  })

  // LEGAL-02: dos versiones publicadas del mismo código son dos obligaciones
  // contradictorias vigentes. Va al final del archivo porque supera al requisito
  // que la primera prueba deja vigente.
  it("admits a single published version per legal code and supersedes the previous one in the same transaction", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const author = access("risk-author", ["prevention:legal:view", "prevention:legal:assess"])
    const reviewer = access("risk-reviewer", ["prevention:legal:assess"])
    const approver = access("risk-approver", ["prevention:legal:approve_applicability"])
    const publisher = access("risk-publisher", ["prevention:legal:approve_applicability"])
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
    const v3Published = await service.transitionLegalRequirement({ requirementId: v3.id, expectedVersion: v3Approved.version, toStatus: "published", reason: "Publicación de la versión 2026 del requisito." }, publisher)

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
    const [supersededHistory] = await readModuleHistory(getDb(), {
      module: "risk_legal:legal", entityType: "requirement", entityId: current!.id, changeType: "superseded",
    })
    expect(supersededHistory).toMatchObject({
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
    const stalePublished = await service.transitionLegalRequirement({ requirementId: stale.id, expectedVersion: staleApproved.version, toStatus: "published", reason: "Publicación del borrador rezagado." }, access("risk-publisher", ["prevention:legal:approve_applicability"]))

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
    const [orphanHistory] = await readModuleHistory(getDb(), {
      module: "risk_legal:legal", entityType: "applicability", entityId: proposed.id, changeType: "superseded",
    })
    expect(orphanHistory).toMatchObject({ afterState: { supersededByRequirementId: v2.id } })
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

  /* D4: la excepción `prevention:sign_own_work` —la misma que usa la MIPER—
   * permite a la jefatura técnica publicar lo que aprobó, pero deja constancia
   * en la bitácora: una firma propia no queda indistinguible de una ajena. */
  it("lets the approver publish a legal requirement only with sign_own_work, and records the exception", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const actors = legalActors()
    const chief = access("risk-approver", ["prevention:legal:view", "prevention:legal:approve_applicability", "prevention:sign_own_work"])
    const published = await publishRequirement(service, {
      code: "DS44-ART30", requirement: "Mantener el registro de la entrega de información de riesgos a cada persona.",
      versionLabel: "Vigente", validFrom: "2025-01-01",
    }, { ...actors, publisher: chief })
    expect(published).toMatchObject({ status: "published", publishedByUserId: "risk-approver", approvedByUserId: "risk-approver" })
    const [entry] = await readModuleHistory(getDb(), {
      module: "risk_legal:legal", entityType: "requirement", entityId: published.id, changeType: "published",
    })
    expect(entry?.reason).toMatch(/Firma propia/)
    expect(entry?.afterState).toEqual(expect.objectContaining({ ownWorkExceptionUsed: true }))
  })

  /* D5: volver a proponer la aplicabilidad de una decisión ya aprobada la
   * devolvía a "propuesta" —borrando la firma de aprobación y el estado de
   * cumplimiento— sin versión esperada ni motivo. Una re-evaluación de lo
   * aprobado tiene que ser explícita: sobre la versión que se vio y diciendo
   * por qué. */
  it("refuses to silently reopen an approved applicability and demands version plus reason to re-evaluate it", async () => {
    const service = await import("@/lib/services/prevention-risk-legal")
    const actors = legalActors()
    const requirement = await publishRequirement(service, {
      code: "DS44-ART31", requirement: "Capacitar a las personas trabajadoras en los riesgos de su puesto.",
      versionLabel: "Vigente", validFrom: "2025-01-01",
    }, actors)
    const base = {
      requirementId: requirement.id, worksiteId: "ws-risk-a", applicabilityStatus: "proposed_not_applicable" as const,
      rationale: "La faena ya no tiene personal propio: toda la dotación es contratista.",
      responsibleSnapshot: "Prevención corporativa",
    }
    const proposed = await service.proposeLegalApplicability({ ...base, applicabilityStatus: "proposed_applicable", rationale: "La faena mantiene personal propio expuesto a los riesgos del puesto." }, actors.author)
    const approved = await service.approveLegalApplicability({ applicabilityId: proposed.id, expectedVersion: proposed.version, reason: "Aplicabilidad contrastada contra la dotación vigente." }, actors.approver)
    expect(approved.applicabilityStatus).toBe("applicable")

    await expect(service.proposeLegalApplicability(base, actors.author)).rejects.toThrow(/ya está aprobada/i)
    await expect(service.proposeLegalApplicability({ ...base, expectedVersion: approved.version, reevaluationReason: "corto" }, actors.author)).rejects.toThrow()
    await expect(service.proposeLegalApplicability({
      ...base, expectedVersion: approved.version - 1, reevaluationReason: "Cambió la dotación de la faena tras el traspaso a contratistas.",
    }, actors.author)).rejects.toThrow(/cambió mientras/i)

    const [untouched] = await getDb().select().from(schema.preventionLegalApplicabilities).where(eq(schema.preventionLegalApplicabilities.id, proposed.id))
    expect(untouched).toMatchObject({ applicabilityStatus: "applicable", approvedByUserId: "risk-approver", version: approved.version })

    const reopened = await service.proposeLegalApplicability({
      ...base, expectedVersion: approved.version, reevaluationReason: "Cambió la dotación de la faena tras el traspaso a contratistas.",
    }, actors.author)
    expect(reopened).toMatchObject({ id: proposed.id, applicabilityStatus: "proposed_not_applicable", approvedByUserId: null, version: approved.version + 1 })
    const entries = await readModuleHistory(getDb(), {
      module: "risk_legal:legal", entityType: "applicability", entityId: proposed.id, changeType: "proposed_not_applicable",
    })
    expect(entries.some((entry) => entry.reason?.includes("Re-evaluación de una aplicabilidad aprobada") && entry.reason.includes("traspaso a contratistas"))).toBe(true)
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
  actors: { author: ReturnType<typeof access>; reviewer: ReturnType<typeof access>; approver: ReturnType<typeof access>; publisher?: ReturnType<typeof access> },
) {
  const draft = await service.createLegalRequirementDraft({
    ...fields, sourceType: "regulatory", authority: "Ministerio del Trabajo",
    sourceTitle: "Decreto Supremo N°44", sourceReference: "DS 44/2024", article: "Artículo 7",
    topic: "MIPER", chomeRole: "Entidad empleadora", evidenceRequired: "MIPER publicada e historial de revisión", frequency: "Anual",
  }, actors.author)
  const submitted = await service.transitionLegalRequirement({ requirementId: draft.id, expectedVersion: draft.version, toStatus: "in_review", reason: `Envío a revisión de ${fields.versionLabel}.` }, actors.author)
  const reviewed = await service.transitionLegalRequirement({ requirementId: draft.id, expectedVersion: submitted.version, toStatus: "reviewed", reason: `Revisión normativa de ${fields.versionLabel}.` }, actors.reviewer)
  const approved = await service.transitionLegalRequirement({ requirementId: draft.id, expectedVersion: reviewed.version, toStatus: "approved", reason: `Aprobación segregada de ${fields.versionLabel}.` }, actors.approver)
  return service.transitionLegalRequirement({ requirementId: draft.id, expectedVersion: approved.version, toStatus: "published", reason: `Publicación de ${fields.versionLabel}.` }, actors.publisher ?? legalActors().publisher)
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
    // D4: la publicación la firma alguien distinto de quien aprobó.
    publisher: access("risk-publisher", ["prevention:legal:view", "prevention:legal:approve_applicability"], ids),
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
  await database.insert(schema.pdtpPrograms).values({ id: "pdtp-risk-program", year: 2026, version: 1, status: "active", appliesToAllWorksites: true, title: "PDTP pruebas P0-05", elaboratedByUserId: "risk-author", elaboratedByName: "Autor", elaboratedByTitle: "Prevencionista", createdAt: now, updatedAt: now })
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

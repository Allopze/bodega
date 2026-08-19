/** Real PostgreSQL proof for the cross-cutting inspection engine. */
import path from "node:path"
import postgres from "postgres"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { fieldKindIsScorable, type InspectionItemSpec } from "@/lib/prevention/inspections"
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

/**
 * Versión vigente del run. Desde C-02 `saveInspectionAnswers` avanza `version`,
 * así que el `expectedVersion` del siguiente envío no puede tomarse de un valor
 * capturado antes de guardar.
 */
async function currentRunVersion(id: string) {
  const [row] = await getDb().select({ version: schema.preventionInspectionRuns.version })
    .from(schema.preventionInspectionRuns)
    .where(eq(schema.preventionInspectionRuns.id, id))
  return row!.version
}

/**
 * Respuesta válida para un ítem según su tipo (B-08).
 *
 * `inspeccion_extintores` mezcla ítems de conformidad con `text`, `date` y
 * `select`: desde B-08 esos NO admiten "Cumple" —su respuesta es su contenido—
 * así que responder la plantilla entera con `conforming` es inválido.
 */
function answerFor(
  item: InspectionItemSpec,
  result: "conforming" | "partial" | "non_conforming" | "not_applicable" = "conforming",
  comment: string | null = null,
) {
  if (!fieldKindIsScorable(item.kind)) {
    return { sectionId: item.sectionId, itemId: item.itemId, result: "recorded" as const, value: "Registrado en terreno" }
  }
  return { sectionId: item.sectionId, itemId: item.itemId, result, comment }
}

/** Conjunto completo de respuestas válidas, con un override opcional por índice. */
function answersForAll(
  items: InspectionItemSpec[],
  override?: (item: InspectionItemSpec, index: number) => ReturnType<typeof answerFor> | undefined,
) {
  return items.map((item, index) => override?.(item, index) ?? answerFor(item))
}

async function countAnswers(runId: string) {
  const rows = await getDb().select({ id: schema.preventionInspectionAnswers.id })
    .from(schema.preventionInspectionAnswers)
    .where(eq(schema.preventionInspectionAnswers.runId, runId))
  return rows.length
}

describeIf("Motor de inspecciones on real PostgreSQL", () => {
  let templateId = ""
  let runId = ""
  let runVersion = 1
  let itemsCache: InspectionItemSpec[] = []

  /** Primer ítem que sí expresa conformidad, para los escenarios cumple/no cumple. */
  const scorableItem = () => itemsCache.find((item) => fieldKindIsScorable(item.kind))!

  /**
   * Acta de cierre exigida por la plantilla (función #2). Desde que el motor
   * la aplica, completar sin ella queda bloqueado — que es el punto.
   */
  async function closingActFor(id: string) {
    const { closingActFromDefinition } = await import("@/lib/prevention/inspections")
    const [template] = await getDb().select().from(schema.preventionInspectionTemplates)
      .where(eq(schema.preventionInspectionTemplates.id, id))
    const spec = closingActFromDefinition(template!.definitionSnapshot as never)
    if (!spec) return undefined
    return {
      result: spec.resultOptions[0]!.value,
      restrictions: null,
      signatures: spec.signatureRoles.map((role) => ({ role, name: `Firmante ${role}` })),
    }
  }

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

  // El contenido viene del catálogo versionado en el repositorio, así que
  // incorporar publica: en una instalación con un solo prevencionista, pedir un
  // aprobador distinto dejaba la plantilla inservible para siempre.
  it("imports an existing SST definition already published and freezes its content hash", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await service.importInspectionTemplate({ definitionCode: "inspeccion_extintores" }, AUTHOR)
    templateId = template.id
    expect(template).toMatchObject({
      status: "approved", approvedByUserId: "in-author", sourceDefinitionCode: "inspeccion_extintores",
    })
    expect(template.approvedAt).toBeTruthy()
    expect(template.contentHash).toHaveLength(64)
  })

  // La puerta de aprobación sigue viva —y segregada— para los borradores que
  // quedaron de antes: sin ella no habría forma de ponerlos en uso.
  it("blocks the importer from approving their own legacy draft", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const draftId = "instpl-legacy-draft"
    await getDb().insert(schema.preventionInspectionTemplates).values({
      id: draftId,
      code: "legacy_draft",
      versionLabel: "01",
      name: "Borrador heredado",
      kind: "inspection",
      definitionSnapshot: { code: "legacy_draft", sections: [] },
      contentHash: "a".repeat(64),
      status: "draft",
      authorUserId: AUTHOR.userId,
    })

    await expect(service.approveInspectionTemplate({
      templateId: draftId, expectedVersion: 1, reason: "Intento de autoaprobación de la plantilla.",
    }, { ...AUTHOR, permissions: [...AUTHOR.permissions, "prevention:inspections:approve"] }))
      .rejects.toThrow(/no puede aprobarla/)

    const approved = await service.approveInspectionTemplate({
      templateId: draftId, expectedVersion: 1, reason: "Contenido revisado y conforme al estándar de la faena.",
    }, APPROVER)
    expect(approved).toMatchObject({ status: "approved", approvedByUserId: "in-approver" })
  })

  it("refuses to run a template that is no longer the current version", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const first = await service.importInspectionTemplate({ definitionCode: "inspeccion_taller" }, AUTHOR)
    await service.importInspectionTemplate({ definitionCode: "inspeccion_taller", versionLabel: "01-rev" }, AUTHOR)
    await expect(service.createInspectionRun({
      templateId: first.id, worksiteId: "ws-in-a",
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
      runId, expectedVersion: await currentRunVersion(runId),
      answers: [{ sectionId: "seccion-inexistente", itemId: "item-fantasma", result: "conforming" }],
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
      runId, expectedVersion: await currentRunVersion(runId),
      answers: [answerFor(scorableItem())],
    }, AUTHOR)

    const [current] = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, runId))
    await expect(service.completeInspectionRun({ runId, expectedVersion: current!.version }, AUTHOR))
      .rejects.toThrow(/No se puede declarar ejecutada/)
  })

  it("requires a reason to mark an item as not applicable", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const target = scorableItem()
    // B-03: el mensaje lo produce el servicio (`validateAnswerRow`) y nombra el
    // ítem. Antes la única guarda era el CHECK de Postgres, que devolvía el
    // texto crudo de la violación y tumbaba el lote entero.
    await expect(service.saveInspectionAnswers({
      runId, expectedVersion: await currentRunVersion(runId),
      answers: [{ sectionId: target.sectionId, itemId: target.itemId, result: "not_applicable", comment: "" }],
    }, AUTHOR)).rejects.toThrow(/exige indicar el motivo/)

    await service.saveInspectionAnswers({
      runId, expectedVersion: await currentRunVersion(runId),
      answers: [{ sectionId: target.sectionId, itemId: target.itemId, result: "not_applicable", comment: "Extintor retirado de servicio." }],
    }, AUTHOR)
    const [stored] = await getDb().select().from(schema.preventionInspectionAnswers)
      .where(eq(schema.preventionInspectionAnswers.runId, runId))
    expect(stored).toMatchObject({ result: "not_applicable" })
  })

  it("completes the run, computes compliance and materializes findings by criticality", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    // Un incumplimiento deliberado en el primer ítem PUNTUABLE: los `text`,
    // `date` y `select` de esta plantilla no expresan conformidad (B-08).
    const failing = scorableItem()
    const answers = answersForAll(itemsCache, (item) =>
      item.itemId === failing.itemId ? answerFor(item, "non_conforming", "Manómetro en zona roja") : undefined)
    await service.saveInspectionAnswers({ runId, expectedVersion: await currentRunVersion(runId), answers }, AUTHOR)

    const [before] = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, runId))
    const result = await service.completeInspectionRun({
      runId, expectedVersion: before!.version, closingAct: await closingActFor(templateId),
    }, AUTHOR)
    runVersion = result.run.version

    expect(result.run.status).toBe("completed")
    expect(result.run.nonConformingCount).toBe(1)
    expect(result.compliancePercent).not.toBeNull()

    const findings = await getDb().select().from(schema.preventionInspectionFindings)
      .where(eq(schema.preventionInspectionFindings.runId, runId))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.description).toContain("Manómetro en zona roja")
    expect(findings[0]?.status).toBe("open")
    // La criticidad la fija el `danoPotencial` del ítem en la plantilla, no
    // quien ejecuta. El comentario anterior daba por hecho que el catálogo no
    // lo declaraba y por eso esperaba "medium": hoy sí lo declara (C-03), así
    // que se comprueba la derivación en vez de un valor fijo.
    const { criticalityFromDanoPotencial } = await import("@/lib/prevention/inspections")
    expect(findings[0]?.criticality).toBe(criticalityFromDanoPotencial(failing.danoPotencial))
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
      runId, expectedVersion: await currentRunVersion(runId),
      answers: [answerFor(scorableItem())],
    }, AUTHOR)).rejects.toThrow(/cerrada o cancelada/)
  })

  /*
   * Esta prueba se INVIRTIÓ (D-3, auditoría 2026-08-18). Antes verificaba que
   * completar avanzaba `nextDueOn` desde la fecha real; ahora el avance es
   * responsabilidad exclusiva del materializador. Tenerlo en los dos lados
   * contaba dos veces el mismo ciclo, y hacerlo desde "hoy" en vez de desde el
   * vencimiento arrastraba el calendario legal (A-12).
   */
  it("completing a run does NOT move the program schedule", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const program = await service.createInspectionProgram({
      templateId, worksiteId: "ws-in-a", frequency: "monthly", startsOn: "2026-08-01",
    }, AUTHOR)
    expect(program).toMatchObject({ intervalDays: 30, nextDueOn: "2026-08-01" })

    const created = await service.createInspectionRun({
      templateId, worksiteId: "ws-in-a", programId: program.id,
    }, AUTHOR)
    // El guardado avanza `version` (C-02), así que el CAS del completar toma la
    // versión devuelta y no la que tenía el run al crearse.
    const saved = await service.saveInspectionAnswers({
      runId: created.run.id,
      expectedVersion: created.run.version,
      answers: answersForAll(itemsCache),
    }, AUTHOR)
    await service.completeInspectionRun({
      runId: created.run.id, expectedVersion: saved.version, closingAct: await closingActFor(templateId),
    }, AUTHOR)

    const [after] = await getDb().select().from(schema.preventionInspectionPrograms)
      .where(eq(schema.preventionInspectionPrograms.id, program.id))
    expect(after!.nextDueOn).toBe("2026-08-01")
  })

  // B-04: la otra mitad. Hasta ahora `programId` no lo enviaba ningún
  // formulario, así que toda programación quedaba vencida para siempre.
  it("materializes the due run from its program, idempotently, and anchors the next date to the due one", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const { materializeProgramRuns } = await import("@/lib/services/prevention-inspection-scheduler")
    const program = await service.createInspectionProgram({
      templateId, worksiteId: "ws-in-a", frequency: "monthly", startsOn: "2026-01-15",
    }, AUTHOR)

    const first = await materializeProgramRuns()
    expect(first.created).toBeGreaterThanOrEqual(1)

    const runs = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.programId, program.id))
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: "planned", scheduledFor: "2026-01-15" })

    // Segundo disparo del mismo día: el índice único por slot lo absorbe.
    await materializeProgramRuns()
    const afterSecond = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.programId, program.id))
    expect(afterSecond).toHaveLength(1)

    // Anclado al vencimiento y rodando en intervalos completos hasta superar
    // hoy: un programa abandonado no genera una ejecución por período perdido.
    const [after] = await getDb().select().from(schema.preventionInspectionPrograms)
      .where(eq(schema.preventionInspectionPrograms.id, program.id))
    expect(after!.nextDueOn > "2026-01-15").toBe(true)
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
    // Puntuable pero sin escala B/R/M: un `select` o un `text` fallaría por no
    // admitir vocabulario de conformidad, no por la escala, que es lo que se prueba.
    const target = itemsCache.find((item) => fieldKindIsScorable(item.kind) && !fieldKindAcceptsPartial(item.kind))!
    expect(target).toBeDefined()
    await expect(service.saveInspectionAnswers({
      runId: created.run.id, expectedVersion: created.run.version,
      answers: [{ sectionId: target.sectionId, itemId: target.itemId, result: "partial", comment: "Desgaste menor." }],
    }, AUTHOR)).rejects.toThrow(/no admite la respuesta "Regular"/)
  })

  it("persists 'partial' end-to-end on a B/R/M template and scores it at 0.5", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const approved = await service.importInspectionTemplate({ definitionCode: "inspeccion_carros" }, AUTHOR)

    const created = await service.createInspectionRun({
      templateId: approved.id, worksiteId: "ws-in-a", subjectLabel: "Carro CR-04",
    }, AUTHOR)
    const brmItems = service.itemsFromDefinition(approved.definitionSnapshot as never)
    expect(brmItems.length).toBeGreaterThanOrEqual(3)

    // 1 Bueno, 1 Regular, resto Bueno: exactamente el caso que antes de H-04
    // el motor no podía siquiera registrar.
    const brmScorable = brmItems.filter((item) => fieldKindIsScorable(item.kind))
    const partialTarget = brmScorable[1]!
    const answers = answersForAll(brmItems, (item) =>
      item.itemId === partialTarget.itemId ? answerFor(item, "partial", "Desgaste menor, aún operativo.") : undefined)
    await service.saveInspectionAnswers({ runId: created.run.id, expectedVersion: created.run.version, answers }, AUTHOR)

    const [before] = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, created.run.id))
    const result = await service.completeInspectionRun({
      runId: created.run.id, expectedVersion: before!.version, closingAct: await closingActFor(approved.id),
    }, AUTHOR)

    expect(result.run.partialCount).toBe(1)
    expect(result.run.conformingCount).toBe(brmScorable.length - 1)
    // (n-1 + 0.5) / n sobre los PUNTUABLES — misma fórmula que lib/sst/compliance.ts.
    // Los ítems que no puntúan salen del denominador (B-08).
    const expected = Math.round(((brmScorable.length - 1 + 0.5) / brmScorable.length) * 100)
    expect(result.compliancePercent).toBe(expected)

    const [stored] = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, created.run.id))
    expect(stored!.partialCount).toBe(1)
    expect(stored!.compliancePercent).toBe(expected)
  })

  // B-05 (auditoría 2026-08-18): `origin` ya se aceptaba en el schema y el
  // CHECK, pero ningún formulario lo exponía — toda inspección nacía
  // 'prevencion' y la certificación CPHS Plata/Oro de Mutual, que exige meses
  // con inspección originada por el propio comité, era inalcanzable.
  it("persists 'cphs' as the run's origin, unblocking CPHS Plata/Oro certification evidence", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const created = await service.createInspectionRun({
      templateId, worksiteId: "ws-in-a", origin: "cphs", subjectLabel: "Ronda del comité paritario",
    }, AUTHOR)
    expect(created.run.origin).toBe("cphs")

    // Misma columna que `gatherCertificationEvidence` (lib/services/prevention-cphs-certification.ts)
    // lee para contar `monthsWithCommitteeInspection` de los niveles Plata/Oro.
    const [stored] = await getDb().select({ origin: schema.preventionInspectionRuns.origin })
      .from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.id, created.run.id))
    expect(stored?.origin).toBe("cphs")
  })

  /* ── Fase 1: ciclo de vida de plantillas ────────────────────────────────── */

  // A-02: reimportar es el camino normal para versionar. La UI escondía del
  // picker toda definición ya incorporada, dejando inalcanzable el mecanismo de
  // `superseded` que el servicio ya implementaba entero.
  // Se usa `inspeccion_contenedores` y NO la plantilla compartida: incorporar
  // la v2 deja la v1 en `superseded`, y `createInspectionRun` sólo acepta
  // vigentes — versionar la plantilla que usan los demás tests los rompería a
  // todos.
  it("reimports a definition as a new version and supersedes the previous approved one", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const v1 = await service.importInspectionTemplate({
      definitionCode: "inspeccion_contenedores", versionLabel: "01",
    }, AUTHOR)
    expect(v1.status).toBe("approved")

    const v2 = await service.importInspectionTemplate({
      definitionCode: "inspeccion_contenedores", versionLabel: "02",
    }, AUTHOR)
    expect(v2).toMatchObject({ status: "approved", code: v1.code })

    const [superseded] = await getDb().select().from(schema.preventionInspectionTemplates)
      .where(eq(schema.preventionInspectionTemplates.id, v1.id))
    expect(superseded).toMatchObject({ status: "superseded", supersededByTemplateId: v2.id })
    expect(superseded!.supersededAt).toBeTruthy()
  })

  // C-10: antes salía el texto crudo "duplicate key value violates unique
  // constraint prevention_inspection_template_version_unique".
  it("rejects a duplicate version label with a readable message", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    await expect(service.importInspectionTemplate({
      definitionCode: "inspeccion_contenedores", versionLabel: "02",
    }, AUTHOR)).rejects.toThrow(/Ya existe la versión "02"/)
  })

  // A-03: el `contentHash` se calculaba al importar y no se leía nunca, así que
  // nada avisaba cuándo el catálogo en código se adelantaba al snapshot.
  it("flags a template whose snapshot drifted from the code catalogue", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const listed = await service.listInspectionTemplates(APPROVER)
    const fresh = listed.find((item) => item.sourceDefinitionCode === "inspeccion_extintores")
    expect(fresh).toBeDefined()
    // Recién importada desde el propio catálogo: no puede haber deriva.
    expect(fresh!.definitionDrifted).toBe(false)
    expect(fresh!.definitionMissing).toBe(false)

    await getDb().update(schema.preventionInspectionTemplates)
      .set({ contentHash: "0".repeat(64) })
      .where(eq(schema.preventionInspectionTemplates.id, fresh!.id))
    const afterDrift = await service.listInspectionTemplates(APPROVER)
    expect(afterDrift.find((item) => item.id === fresh!.id)!.definitionDrifted).toBe(true)
  })

  /* ── Fase 2: guardado de respuestas ─────────────────────────────────────── */

  // B-02: el payload declara el conjunto completo. Antes el upsert nunca
  // borraba, así que devolver un ítem a "Sin responder" dejaba viva la fila
  // anterior y el cliente contaba una respuesta menos que el servidor.
  it("deletes answers omitted from the payload instead of leaving them behind", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const created = await service.createInspectionRun({ templateId, worksiteId: "ws-in-a" }, AUTHOR)
    const three = itemsCache.filter((item) => fieldKindIsScorable(item.kind)).slice(0, 3)
    expect(three).toHaveLength(3)

    const first = await service.saveInspectionAnswers({
      runId: created.run.id, expectedVersion: created.run.version,
      answers: three.map((item) => answerFor(item)),
    }, AUTHOR)
    expect(first.saved).toBe(3)
    expect(await countAnswers(created.run.id)).toBe(3)

    const second = await service.saveInspectionAnswers({
      runId: created.run.id, expectedVersion: first.version,
      answers: three.slice(0, 2).map((item) => answerFor(item)),
    }, AUTHOR)
    expect(second).toMatchObject({ saved: 2, removed: 1 })
    expect(await countAnswers(created.run.id)).toBe(2)

    // Un conjunto vacío borra todo: antes el `.min(1)` del Zod impedía siquiera
    // desmarcar el último ítem.
    const cleared = await service.saveInspectionAnswers({
      runId: created.run.id, expectedVersion: second.version, answers: [],
    }, AUTHOR)
    expect(cleared).toMatchObject({ saved: 0, removed: 2 })
    expect(await countAnswers(created.run.id)).toBe(0)
  })

  // B-03: una respuesta inválida no puede llevarse por delante las válidas del
  // mismo lote. El CHECK de Postgres tumbaba el INSERT completo.
  it("rejects an invalid row without persisting the valid ones in the same batch", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const created = await service.createInspectionRun({ templateId, worksiteId: "ws-in-a" }, AUTHOR)
    const [good, bad] = itemsCache.filter((item) => fieldKindIsScorable(item.kind))

    await expect(service.saveInspectionAnswers({
      runId: created.run.id, expectedVersion: created.run.version,
      answers: [
        answerFor(good!),
        { sectionId: bad!.sectionId, itemId: bad!.itemId, result: "not_applicable" as const, comment: "" },
      ],
    }, AUTHOR)).rejects.toThrow(/exige indicar el motivo/)

    expect(await countAnswers(created.run.id)).toBe(0)
    expect(await currentRunVersion(created.run.id)).toBe(created.run.version)
  })

  // B-01: el defecto de raíz era que el cliente evaluaba el gate sobre su
  // borrador y el servidor puntuaba lo último persistido. Ahora completar
  // acepta el conjunto y lo guarda en la misma transacción.
  it("completes in one transaction from the answers supplied, without a prior save", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const created = await service.createInspectionRun({ templateId, worksiteId: "ws-in-a" }, AUTHOR)
    expect(await countAnswers(created.run.id)).toBe(0)

    const result = await service.completeInspectionRun({
      runId: created.run.id,
      expectedVersion: created.run.version,
      answers: answersForAll(itemsCache),
      locationLatitude: "-36.826100",
      locationLongitude: "-73.049800",
      closingAct: await closingActFor(templateId),
    }, AUTHOR)

    expect(result.run.status).toBe("completed")
    expect(await countAnswers(created.run.id)).toBe(itemsCache.length)
    // Función faltante #8: las coordenadas ya se aceptaban y nada las enviaba.
    expect(result.run.locationLatitude).toBe("-36.826100")
    expect(result.run.locationLongitude).toBe("-73.049800")
  })

  // C-02: dos inspectores con el mismo run abierto se pisaban en silencio.
  it("rejects a second save that reuses a stale expectedVersion", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const created = await service.createInspectionRun({ templateId, worksiteId: "ws-in-a" }, AUTHOR)
    const stale = created.run.version
    const answers = [answerFor(scorableItem())]

    await service.saveInspectionAnswers({ runId: created.run.id, expectedVersion: stale, answers }, AUTHOR)
    await expect(service.saveInspectionAnswers({ runId: created.run.id, expectedVersion: stale, answers }, AUTHOR))
      .rejects.toThrow(/cambió en otra sesión/)
  })

  // C-01: cambiar una respuesta es lo único que el inspector hace en terreno y
  // no dejaba rastro en la bitácora que el propio esquema llama "inmutable".
  it("writes an audit trail entry for every answer save", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const created = await service.createInspectionRun({ templateId, worksiteId: "ws-in-a" }, AUTHOR)
    await service.saveInspectionAnswers({
      runId: created.run.id, expectedVersion: created.run.version,
      answers: [answerFor(scorableItem())],
    }, AUTHOR)

    const entries = await getDb().select().from(schema.preventionInspectionHistory)
      .where(eq(schema.preventionInspectionHistory.entityId, created.run.id))
    const saved = entries.filter((row) => row.changeType === "answers_saved")
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ entityType: "run", actorUserId: "in-author", worksiteId: "ws-in-a" })
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

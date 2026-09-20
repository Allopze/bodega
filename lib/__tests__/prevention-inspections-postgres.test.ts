/** Real PostgreSQL proof for the cross-cutting inspection engine. */
import path from "node:path"
import postgres from "postgres"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { Session } from "next-auth"
import type { WorksiteScope } from "@/lib/auth/scope"
import { fieldKindIsScorable, type InspectionItemSpec } from "@/lib/prevention/inspections"
import { officialInspectionSourceFor } from "@/lib/sst/official-inspection-sources"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"
import { readModuleHistory } from "@/lib/testing/audit-history"

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
/* Mantener el catálogo maestro y calibrar un instrumento son dos actos con dos
 * permisos: `admin:deviation_catalog` y `prevention:inspections:manage`. En la
 * práctica los tiene la misma persona (el rol `prevencionista`), pero los tests
 * los separan para que el día que se dividan no pasen por accidente. */
const CATALOGER = { ...AUTHOR, permissions: [...AUTHOR.permissions, "admin:deviation_catalog"] }
const APPROVER = { userId: "in-approver", scope: scopeA, permissions: ALL }
const REVIEWER = { userId: "in-reviewer", scope: scopeA, permissions: ["prevention:inspections:view", "prevention:inspections:review"] }
const OUTSIDER = { userId: "in-outsider", scope: { mode: "some", ids: ["ws-in-b"] } as WorksiteScope, permissions: ALL }
/** Mantenciones resuelve alcance con `Session`, no con `InspectionAccess`. */
const MAINT_SESSION = {
  user: { id: "in-author", isGlobal: false, worksiteIds: ["ws-in-a"], roles: [], permissions: ["mantenciones:edit"] },
} as unknown as Session

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

/**
 * Versión de la Biblioteca SST que respalda a un anexo oficial del SGI.
 *
 * `approveInspectionTemplate` no habilita una plantilla `official_document` sin
 * una versión documental vinculada, con paridad declarada y **el checksum del
 * binario original**. Los anexos se cotejan contra
 * `OFFICIAL_INSPECTION_SOURCES`, así que la fila que siembra esta función lleva
 * ese mismo `sha256`: sin él el servicio la rechaza por integridad, que es
 * exactamente lo que debe hacer.
 *
 * Memoizada por definición: varias pruebas incorporan versiones sucesivas del
 * mismo instrumento y todas cuelgan del mismo documento.
 */
const officialSourceVersions = new Map<string, string>()

async function officialSourceVersionFor(definitionCode: string): Promise<string | undefined> {
  const source = officialInspectionSourceFor(definitionCode)
  // `reporte_equipos` exige respaldo documental sin estar en el catálogo de
  // anexos: no hay checksum contra el que cotejar, pero sí hace falta la fila.
  if (!source && definitionCode !== "reporte_equipos") return undefined

  const cached = officialSourceVersions.get(definitionCode)
  if (cached) return cached

  const now = new Date().toISOString()
  const documentId = `sstdoc-${definitionCode}`
  const versionId = `sstdocv-${definitionCode}`
  await getDb().insert(schema.sstDocuments).values({
    id: documentId,
    categorySlug: SST_CATEGORY,
    title: source?.fileName ?? `Respaldo documental de ${definitionCode}`,
    status: "vigente",
    uploadedBy: AUTHOR.userId,
    createdAt: now,
    updatedAt: now,
  })
  await getDb().insert(schema.sstDocumentVersions).values({
    id: versionId,
    documentId,
    version: 1,
    status: "vigente",
    fileName: source?.fileName ?? `${definitionCode}.xlsx`,
    storageName: `${definitionCode}.xlsx`,
    filePath: `storage/sst-documents/${definitionCode}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileSize: 1024,
    checksum: source?.sha256 ?? "f".repeat(64),
    effectiveFrom: source?.effectiveDate ?? null,
    uploadedBy: AUTHOR.userId,
    createdAt: now,
    updatedAt: now,
  })
  await getDb().update(schema.sstDocuments)
    .set({ currentVersionId: versionId })
    .where(eq(schema.sstDocuments.id, documentId))

  officialSourceVersions.set(definitionCode, versionId)
  return versionId
}

/**
 * Incorpora una definición adjuntando su respaldo documental cuando el
 * instrumento lo exige. Los anexos del SGI no pueden habilitarse sin él, así
 * que las pruebas que necesitan una plantilla usable pasan por acá en vez de
 * llamar al servicio en crudo.
 */
async function importTemplate(
  input: { definitionCode: string; kind?: "inspection" | "observation" | "audit"; versionLabel?: string; pdtpActivityNumbers?: number[] },
  access: typeof AUTHOR = AUTHOR,
) {
  const service = await import("@/lib/services/prevention-inspections")
  const sourceDocumentVersionId = await officialSourceVersionFor(input.definitionCode)
  return service.importInspectionTemplate({
    ...input,
    ...(sourceDocumentVersionId
      ? {
          sourceDocumentVersionId,
          parityReport: { status: "passed" as const, expectedItems: null, actualItems: null, differences: [] },
        }
      : {}),
  }, access)
}

/**
 * Instala un instrumento listo para usar: incorporar deja borrador y habilitar
 * es un acto aparte, así que los casos que sólo necesitan una plantilla
 * ejecutable hacen los dos pasos por acá en vez de repetirlos.
 */
async function installTemplate(
  input: { definitionCode: string; kind?: "inspection" | "observation" | "audit"; versionLabel?: string; pdtpActivityNumbers?: number[] },
) {
  const service = await import("@/lib/services/prevention-inspections")
  const draft = await importTemplate(input)
  return service.approveInspectionTemplate({
    templateId: draft.id, expectedVersion: draft.version,
    reason: "Instrumento habilitado para la faena en la prueba.",
  }, APPROVER)
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
  // La cadena completa ya supera 200 migraciones; en un contenedor frío puede
  // tardar algo más de un minuto antes de que empiece la primera prueba.
  }, 120_000)

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

  /**
   * El Anexo 7 SÍ se incorpora desde que se digitalizó con
   * `recordsPreventiveActions`: aporta al motor —registra acciones preventivas
   * y las lleva al PDTP— aunque no puntúe ningún ítem.
   *
   * Esta prueba afirmaba lo contrario y llevaba tiempo en rojo:
   * `NON_INSPECTION_DEFINITION_CODES` está vacío, así que
   * `isNonInspectionDefinition` no excluye a nadie y el servicio nunca lanzó
   * "no es un instrumento". Lo que sí sigue fuera son las evaluaciones de
   * personas, que pertenecen al módulo de Evaluaciones.
   */
  it("admite la Observación Planeada: no puntúa, pero registra acciones preventivas", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const importables = service.listImportableDefinitions().map((item) => item.code)
    expect(importables).toContain("observacion_planeada")
    // Las otras dos observaciones siguen estando.
    expect(importables).toContain("observacion_ampliroll")
    expect(importables).toContain("observacion_maquinaria")

    const template = await importTemplate({ definitionCode: "observacion_planeada" })
    expect(template).toMatchObject({ status: "draft", sourceDefinitionCode: "observacion_planeada" })
  })

  // Incorporar y habilitar son dos actos distintos: el instrumento nace en
  // borrador y alguien deja constancia de que lo pone en uso.
  it("imports an existing SST definition as a draft and freezes its content hash", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const template = await importTemplate({ definitionCode: "inspeccion_extintores" })
    templateId = template.id
    expect(template).toMatchObject({
      status: "draft", sourceDefinitionCode: "inspeccion_extintores",
    })
    expect(template.approvedAt).toBeNull()
    expect(template.contentHash).toHaveLength(64)

    // No puede programarse mientras siga en borrador.
    await expect(service.createInspectionProgram({
      templateId, worksiteId: "ws-in-a", frequency: "monthly", startsOn: "2026-09-01",
    }, AUTHOR)).rejects.toThrow(/aprobada/i)
  })

  // Sin segregación en plantillas: el contenido viene del catálogo versionado
  // en el repositorio, no lo redacta nadie acá, así que exigir un segundo par
  // de ojos no revisaba nada y dejaba el instrumento inservible cuando el Jefe
  // de Prevención era quien lo instalaba.
  it("lets whoever imported the template approve it", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const [before] = await getDb().select().from(schema.preventionInspectionTemplates)
      .where(eq(schema.preventionInspectionTemplates.id, templateId))
    const approved = await service.approveInspectionTemplate({
      templateId, expectedVersion: before!.version,
      reason: "Instrumento revisado y habilitado para la faena.",
    }, { ...AUTHOR, permissions: [...AUTHOR.permissions, "prevention:inspections:approve"] })
    expect(approved).toMatchObject({ status: "approved", approvedByUserId: "in-author" })
    expect(approved.approvedAt).toBeTruthy()

    // La segregación que sí importa sigue intacta: quien ejecuta una
    // inspección no puede revisarla. Eso lo cubre `assessRunReview`.
  })

  it("still requires the approve permission, and only for drafts", async () => {
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

    // AUTHOR no tiene `:approve`.
    await expect(service.approveInspectionTemplate({
      templateId: draftId, expectedVersion: 1, reason: "Intento sin permiso de aprobación.",
    }, AUTHOR)).rejects.toThrow()

    const approved = await service.approveInspectionTemplate({
      templateId: draftId, expectedVersion: 1, reason: "Contenido revisado y conforme al estándar de la faena.",
    }, APPROVER)
    expect(approved).toMatchObject({ status: "approved", approvedByUserId: "in-approver" })

    // Y una ya aprobada no se re-aprueba.
    await expect(service.approveInspectionTemplate({
      templateId: draftId, expectedVersion: approved.version, reason: "Segunda aprobación de la misma plantilla.",
    }, APPROVER)).rejects.toThrow(/borrador/i)
  })

  it("retira una plantilla sin uso borrándola, y conserva la que tiene ejecuciones", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const spare = await importTemplate({ definitionCode: "inspeccion_contenedores" })
    // Nunca se usó: se elimina de verdad.
    const gone = await service.retireInspectionTemplate({
      templateId: spare.id, reason: "Instrumento que esta faena no ocupa.",
    }, APPROVER)
    expect(gone).toMatchObject({ outcome: "deleted", runs: 0, programs: 0 })
    const rows = await getDb().select().from(schema.preventionInspectionTemplates)
      .where(eq(schema.preventionInspectionTemplates.id, spare.id))
    expect(rows).toHaveLength(0)
  })

  it("refuses to run a template that is no longer the current version", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const first = await installTemplate({ definitionCode: "inspeccion_taller" })
    await installTemplate({ definitionCode: "inspeccion_taller", versionLabel: "01-rev" })
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

  it("surfaces an executable inspection in Prevention attention", async () => {
    const { getPreventionAttention } = await import("@/lib/services/prevention-attention")
    const items = await getPreventionAttention({
      worksiteIds: ["ws-in-a"],
      includeActions: false,
      includeEvaluations: false,
      includePpa: false,
      inspectionStatuses: ["planned", "in_progress"],
    })
    expect(items).toContainEqual(expect.objectContaining({
      id: `inspection:${runId}`,
      kind: "inspection",
      href: `/prevencion/inspecciones/${runId}`,
    }))
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

  /**
   * La regla es "una respuesta que no es conforme exige motivo", y se prueba
   * con el resultado que la escala del instrumento SÍ ofrece. El Anexo 2 se
   * responde Bueno/Malo —`bueno_malo_obs`—, así que pedir "No aplica" acá lo
   * rechaza antes por escala y nunca llega a la guarda del motivo, que es lo
   * que este caso vigila. La rama de "No aplica" vive en los instrumentos cuya
   * escala la ofrece.
   */
  it("requires a reason for an answer that is not conforming", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const target = scorableItem()
    // B-03: el mensaje lo produce el servicio (`validateAnswerRow`) y nombra el
    // ítem. Antes la única guarda era el CHECK de Postgres, que devolvía el
    // texto crudo de la violación y tumbaba el lote entero.
    await expect(service.saveInspectionAnswers({
      runId, expectedVersion: await currentRunVersion(runId),
      answers: [{ sectionId: target.sectionId, itemId: target.itemId, result: "non_conforming", comment: "" }],
    }, AUTHOR)).rejects.toThrow(/exige indicar el motivo/)

    await service.saveInspectionAnswers({
      runId, expectedVersion: await currentRunVersion(runId),
      answers: [{ sectionId: target.sectionId, itemId: target.itemId, result: "non_conforming", comment: "Extintor retirado de servicio." }],
    }, AUTHOR)
    const [stored] = await getDb().select().from(schema.preventionInspectionAnswers)
      .where(eq(schema.preventionInspectionAnswers.runId, runId))
    expect(stored).toMatchObject({ result: "non_conforming" })
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

  it("surfaces a completed inspection as pending review in Prevention attention", async () => {
    const { getPreventionAttention } = await import("@/lib/services/prevention-attention")
    const items = await getPreventionAttention({
      worksiteIds: ["ws-in-a"],
      includeActions: false,
      includeEvaluations: false,
      includePpa: false,
      inspectionStatuses: ["completed"],
    })
    expect(items).toContainEqual(expect.objectContaining({
      id: `inspection:${runId}`,
      title: expect.stringContaining("Revisar"),
      detail: expect.stringContaining("pendiente de revisión"),
    }))
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

    await expect(service.createFindingCapa({
      findingId: finding!.id,
      actionDescription: "Intento de derivar sin una persona responsable.",
    }, AUTHOR)).rejects.toThrow()

    const linked = await service.createFindingCapa({
      findingId: finding!.id,
      actionDescription: "Recargar y certificar el extintor, y verificar el resto del sector.",
      immediateMeasure: "Extintor retirado de servicio y reemplazado por uno operativo.",
      responsibleUserId: AUTHOR.userId,
    }, AUTHOR)
    expect(linked.finding).toMatchObject({ status: "capa_linked" })
    expect(linked.finding.capaActionId).toBeTruthy()
    // Un hallazgo sin equipo sigue sólo en CAPA: no existe un activo sobre el
    // cual abrir una orden de taller.
    expect(linked.maintenanceId).toBeNull()

    const capa = await getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceType, "inspection"))
    expect(capa).toHaveLength(1)
    expect(capa[0]).toMatchObject({ sourceId: runId, worksiteId: "ws-in-a" })

    await expect(service.createFindingCapa({
      findingId: finding!.id, actionDescription: "Intento de duplicar la acción del mismo hallazgo.",
      responsibleUserId: AUTHOR.userId,
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

  /**
   * INS-04/INS-05: el sujeto del programa se propagaba como par de FK pero sin
   * su etiqueta, así que la inspección programada del extintor del pañol nacía
   * sin decir de cuál — la bandeja no la encontraba al buscar por sujeto y el
   * acta imprimía "—". Ahora se congela igual que en el alta ad-hoc.
   */
  it("propaga el sujeto del programa Y congela su etiqueta al materializar", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const { materializeProgramRuns } = await import("@/lib/services/prevention-inspection-scheduler")
    const program = await service.createInspectionProgram({
      templateId, worksiteId: "ws-in-a", frequency: "monthly", startsOn: "2026-02-10",
      subjectVehicleId: "veh-a",
    }, AUTHOR)

    await materializeProgramRuns({ programId: program.id })
    const [run] = await getDb().select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.programId, program.id))

    expect(run!.subjectVehicleId).toBe("veh-a")
    // Lo que faltaba: sin esto quedaba en null y el sujeto era invisible.
    expect(run!.subjectLabel).toBeTruthy()
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
    // El Anexo 2 se responde Bueno/Malo (`bueno_malo_obs`): ningún ítem admite
    // 'partial'.
    // Puntuable pero sin escala B/R/M: un `select` o un `text` fallaría por no
    // admitir vocabulario de conformidad, no por la escala, que es lo que se prueba.
    const target = itemsCache.find((item) => fieldKindIsScorable(item.kind) && !fieldKindAcceptsPartial(item.kind))!
    expect(target).toBeDefined()
    await expect(service.saveInspectionAnswers({
      runId: created.run.id, expectedVersion: created.run.version,
      answers: [{ sectionId: target.sectionId, itemId: target.itemId, result: "partial", comment: "Desgaste menor." }],
      // El mensaje nombra lo que el ítem SÍ admite, en el vocabulario del anexo.
    }, AUTHOR)).rejects.toThrow(/se responde Bueno, Malo/)
  })

  it("persists 'partial' end-to-end on a B/R/M template and scores it at 0.5", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const approved = await installTemplate({ definitionCode: "inspeccion_carros" })

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
  it("reimports a definition as a new version and supersedes the previous only when approved", async () => {
    const service = await import("@/lib/services/prevention-inspections")
    const v1 = await installTemplate({ definitionCode: "inspeccion_contenedores", versionLabel: "01" })
    expect(v1.status).toBe("approved")

    // Incorporar la v2 la deja en borrador y NO jubila a la v1: sacar de
    // circulación al instrumento en uso por un borrador que quizás nadie
    // apruebe dejaría a la faena sin nada que ejecutar.
    const draft = await importTemplate({
      definitionCode: "inspeccion_contenedores", versionLabel: "02",
    })
    expect(draft.status).toBe("draft")
    const [stillLive] = await getDb().select().from(schema.preventionInspectionTemplates)
      .where(eq(schema.preventionInspectionTemplates.id, v1.id))
    expect(stillLive!.status).toBe("approved")

    // El relevo ocurre al habilitarla.
    const v2 = await service.approveInspectionTemplate({
      templateId: draft.id, expectedVersion: draft.version,
      reason: "Versión 02 revisada y puesta en uso.",
    }, APPROVER)
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
        // Sin motivo: la escala del Anexo 2 no ofrece "No aplica", así que la
        // fila inválida es un "Malo" mudo.
        { sectionId: bad!.sectionId, itemId: bad!.itemId, result: "non_conforming" as const, comment: "" },
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

    const saved = await readModuleHistory(getDb(), {
      module: "inspection", entityType: "run", entityId: created.run.id, changeType: "answers_saved",
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ actorUserId: "in-author", worksiteId: "ws-in-a" })
  })

  /* ── Taller: equipo de flota como sujeto, hallazgo → CAPA → mantención ──── */
  describe("Reporte de equipos y derivación al taller", () => {
    let reporteTemplateId = ""
    let reporteRunId = ""

    /** Respuestas válidas del reporte para un camión simple, con una falla de frenos. */
    function reporteAnswers(items: InspectionItemSpec[]) {
      return items
        .filter((item) => item.required || (item.countsForCompliance && fieldKindIsScorable(item.kind)))
        .map((item) => {
          if (!fieldKindIsScorable(item.kind)) {
            return {
              sectionId: item.sectionId,
              itemId: item.itemId,
              result: "recorded" as const,
              value: item.kind === "number" ? "134122" : item.kind === "select" ? "tarde" : "Patio madera",
            }
          }
          if (item.itemId === "freno_servicio") {
            return { sectionId: item.sectionId, itemId: item.itemId, result: "non_conforming" as const, comment: "Pedal esponjoso" }
          }
          return { sectionId: item.sectionId, itemId: item.itemId, result: "conforming" as const, comment: null }
        })
    }

    it("importa el Reporte de Equipos y acredita sólo la actividad PDTP n=25", async () => {
      const template = await installTemplate({ definitionCode: "reporte_equipos", pdtpActivityNumbers: [25] })
      reporteTemplateId = template.id
      expect(template.status).toBe("approved")
      // n=26 y n=28 son actividades de revisión: acreditarlas al ejecutar
      // afirmaría que el supervisor firmó cuando sólo se digitó el papel.
      expect(template.pdtpActivityNumbers).toEqual([25])
    })

    it("lista los equipos de la faena como sujetos inspeccionables", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const subjects = await service.listInspectionSubjects("ws-in-a", AUTHOR)
      const vehicle = subjects.find((item) => item.source === "vehicle")
      expect(vehicle).toMatchObject({ id: "veh-a", name: "KA-122 · ABCD12" })
      // El equipo de la otra faena no aparece.
      expect(subjects.map((item) => item.id)).not.toContain("veh-b")
    })

    it("rechaza un equipo de otra faena como sujeto", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      await expect(service.createInspectionRun({
        templateId: reporteTemplateId, worksiteId: "ws-in-a", subjectVehicleId: "veh-b",
      }, AUTHOR)).rejects.toThrow(/otra faena/i)
    })

    it("rechaza declarar dos sujetos a la vez", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      await expect(service.createInspectionRun({
        templateId: reporteTemplateId, worksiteId: "ws-in-a",
        subjectVehicleId: "veh-a", subjectResourceId: "res-cualquiera",
      }, AUTHOR)).rejects.toThrow(/un solo sujeto/i)
    })

    it("congela la etiqueta del equipo al crear la ejecución", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const { run } = await service.createInspectionRun({
        templateId: reporteTemplateId, worksiteId: "ws-in-a", subjectVehicleId: "veh-a",
      }, AUTHOR)
      reporteRunId = run.id
      expect(run.subjectLabel).toBe("KA-122 · ABCD12")
      expect(run.subjectVehicleId).toBe("veh-a")
    })

    it("rechaza el horómetro con separador de miles del papel", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      await expect(service.saveInspectionAnswers({
        runId: reporteRunId, expectedVersion: await currentRunVersion(reporteRunId),
        answers: [{ sectionId: "horometro", itemId: "horometro_inicio", result: "recorded", value: "134.122" }],
      }, AUTHOR)).rejects.toThrow(/separador de miles/i)
    })

    it("deriva la falla de frenos a CAPA crítica y abre la mantención del equipo", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const [template] = await getDb().select().from(schema.preventionInspectionTemplates)
        .where(eq(schema.preventionInspectionTemplates.id, reporteTemplateId))
      const items = service.itemsFromDefinition(template!.definitionSnapshot as never)

      await service.saveInspectionAnswers({
        runId: reporteRunId, expectedVersion: await currentRunVersion(reporteRunId), answers: reporteAnswers(items),
      }, AUTHOR)
      await service.completeInspectionRun({
        runId: reporteRunId, expectedVersion: await currentRunVersion(reporteRunId),
        closingAct: await closingActFor(reporteTemplateId),
      }, AUTHOR)

      const [finding] = await getDb().select().from(schema.preventionInspectionFindings)
        .where(eq(schema.preventionInspectionFindings.runId, reporteRunId))
      // `danoPotencial: 'fatal'` en frenos ⇒ criticidad crítica.
      expect(finding).toMatchObject({ criticality: "critical" })

      const linked = await service.createFindingCapa({
        findingId: finding!.id,
        actionDescription: "Cambiar cilindro maestro y purgar el sistema de frenos.",
        responsibleUserId: AUTHOR.userId,
      }, AUTHOR)
      expect(linked.maintenanceId).toBeTruthy()

      const [record] = await getDb().select().from(schema.maintenanceRecords)
        .where(eq(schema.maintenanceRecords.inspectionFindingId, finding!.id))
      expect(record).toMatchObject({
        vehicleId: "veh-a", worksiteId: "ws-in-a", status: "scheduled", maintenanceType: "correctiva",
        // El camión mide por horómetro, así que la lectura va a esa columna.
        hourMeterReading: 134122, odometerReading: null,
      })
      // El plazo del taller y el de la acción correctiva son el mismo día.
      const [capa] = await getDb().select().from(schema.preventionCapaActions)
        .where(eq(schema.preventionCapaActions.id, linked.capaId))
      expect(record!.maintenanceDate).toBe(capa!.targetDate)
      expect(capa).toMatchObject({ priority: "critical", requiresImmediateStop: true })
    })

    it("completar, reabrir, recompletar concurrentemente y cancelar mantiene una sola evidencia CAPA coherente", async () => {
      const maintenance = await import("@/lib/services/maintenance")
      const [finding] = await getDb().select().from(schema.preventionInspectionFindings)
        .where(eq(schema.preventionInspectionFindings.runId, reporteRunId))
      const [record] = await getDb().select().from(schema.maintenanceRecords)
        .where(eq(schema.maintenanceRecords.inspectionFindingId, finding!.id))

      const before = await getDb().select().from(schema.preventionCapaEvidence)
        .where(eq(schema.preventionCapaEvidence.actionId, finding!.capaActionId!))
      expect(before).toHaveLength(0)

      // Simula una colisión histórica previa a la reserva del namespace. El
      // cierre debe canonicalizarla como documento, no dejar una nota activa
      // que CAPA no cuenta como evidencia verificable.
      await getDb().insert(schema.preventionCapaEvidence).values({
        id: "legacy-maintenance-reference-collision",
        actionId: finding!.capaActionId!,
        kind: "note",
        reference: `mantencion:${record!.id}`,
        description: "Referencia histórica mal tipada",
        uploadedByUserId: "in-author",
        createdAt: new Date().toISOString(),
      })

      await maintenance.transitionMaintenanceRecord(MAINT_SESSION, {
        id: record!.id,
        expectedStatus: "scheduled",
        transition: "complete",
        reason: "Frenos reparados y verificados",
      })

      const completed = await getDb().select().from(schema.preventionCapaEvidence)
        .where(eq(schema.preventionCapaEvidence.actionId, finding!.capaActionId!))
      expect(completed).toHaveLength(1)
      expect(completed[0]).toMatchObject({
        id: "legacy-maintenance-reference-collision",
        kind: "document",
        reference: `mantencion:${record!.id}`,
        status: "active",
        checksumSha256: null,
      })
      const [closedFinding] = await getDb().select().from(schema.preventionInspectionFindings)
        .where(eq(schema.preventionInspectionFindings.id, finding!.id))
      expect(closedFinding).toMatchObject({
        status: "closed",
        closedByUserId: MAINT_SESSION.user.id,
      })
      expect(closedFinding!.closedAt).toBeTruthy()
      const [pendingVerification] = await getDb().select().from(schema.preventionCapaActions)
        .where(eq(schema.preventionCapaActions.id, finding!.capaActionId!))
      expect(pendingVerification).toMatchObject({
        status: "pending_verification",
        completedByUserId: MAINT_SESSION.user.id,
      })
      expect(pendingVerification!.completedAt).toBeTruthy()

      await maintenance.transitionMaintenanceRecord(MAINT_SESSION, {
        id: record!.id,
        expectedStatus: "completed",
        transition: "reopen",
        reason: "Persistió vibración en prueba de ruta",
      })
      const [superseded] = await getDb().select().from(schema.preventionCapaEvidence)
        .where(eq(schema.preventionCapaEvidence.id, completed[0]!.id))
      expect(superseded).toMatchObject({
        status: "superseded",
        supersessionReason: "Persistió vibración en prueba de ruta",
        description: `Evidencia automática de la mantención correctiva programada para el ${record!.maintenanceDate}.`,
      })
      expect(superseded!.description).not.toMatch(/estado vigente/i)
      const [reopenedFinding] = await getDb().select().from(schema.preventionInspectionFindings)
        .where(eq(schema.preventionInspectionFindings.id, finding!.id))
      expect(reopenedFinding).toMatchObject({
        status: "capa_linked",
        closedByUserId: null,
        closedAt: null,
      })
      const [reopenedCapa] = await getDb().select().from(schema.preventionCapaActions)
        .where(eq(schema.preventionCapaActions.id, finding!.capaActionId!))
      expect(reopenedCapa).toMatchObject({ status: "reopened" })

      const attempts = await Promise.allSettled([
        maintenance.transitionMaintenanceRecord(MAINT_SESSION, {
          id: record!.id, expectedStatus: "in_progress", transition: "complete", reason: "Segunda reparación verificada",
        }),
        maintenance.transitionMaintenanceRecord(MAINT_SESSION, {
          id: record!.id, expectedStatus: "in_progress", transition: "complete", reason: "Cierre concurrente duplicado",
        }),
      ])
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1)
      expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1)

      const recompleted = await getDb().select().from(schema.preventionCapaEvidence)
        .where(eq(schema.preventionCapaEvidence.actionId, finding!.capaActionId!))
      expect(recompleted).toHaveLength(1)
      expect(recompleted[0]).toMatchObject({ id: completed[0]!.id, status: "active" })

      await maintenance.transitionMaintenanceRecord(MAINT_SESSION, {
        id: record!.id,
        expectedStatus: "completed",
        transition: "cancel",
        reason: "Orden invalidada por diagnóstico incorrecto",
      })
      const [cancelled] = await getDb().select().from(schema.preventionCapaEvidence)
        .where(eq(schema.preventionCapaEvidence.id, completed[0]!.id))
      expect(cancelled).toMatchObject({ status: "superseded", supersessionReason: "Orden invalidada por diagnóstico incorrecto" })
      expect(cancelled!.description).not.toMatch(/estado vigente/i)
    })

    it("no abre una segunda mantención para el mismo hallazgo", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const [finding] = await getDb().select().from(schema.preventionInspectionFindings)
        .where(eq(schema.preventionInspectionFindings.runId, reporteRunId))
      // La segunda derivación se rechaza antes por la CAPA ya enlazada; el
      // índice único parcial es la red por debajo.
      await expect(service.createFindingCapa({
        findingId: finding!.id, actionDescription: "Otra acción distinta.", responsibleUserId: AUTHOR.userId,
      }, AUTHOR)).rejects.toThrow(/ya tiene una acción CAPA/i)
    })

    it("saca el equipo de servicio sólo cuando alguien lo confirma", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const [before] = await getDb().select().from(schema.fuelVehicles)
        .where(eq(schema.fuelVehicles.id, "veh-a"))
      // Derivar la falla crítica NO detiene el equipo por su cuenta.
      expect(before!.operationalStatus).toBe("operativo")

      const [finding] = await getDb().select().from(schema.preventionInspectionFindings)
        .where(eq(schema.preventionInspectionFindings.runId, reporteRunId))
      await service.stopVehicleForFinding({
        findingId: finding!.id, reason: "Frenos sin respuesta, se traslada a taller.",
      }, AUTHOR)

      const [after] = await getDb().select().from(schema.fuelVehicles)
        .where(eq(schema.fuelVehicles.id, "veh-a"))
      expect(after!.operationalStatus).toBe("fuera_servicio")
      // Un solo intervalo abierto: el índice único parcial lo exige.
      const intervals = await getDb().select().from(schema.fuelVehicleOperationalIntervals)
        .where(eq(schema.fuelVehicleOperationalIntervals.vehicleId, "veh-a"))
      expect(intervals.filter((item) => item.endedAt === null)).toHaveLength(1)
    })

    it("no deja detener un equipo fuera del alcance de faena", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const [finding] = await getDb().select().from(schema.preventionInspectionFindings)
        .where(eq(schema.preventionInspectionFindings.runId, reporteRunId))
      await expect(service.stopVehicleForFinding({
        findingId: finding!.id, reason: "Intento desde otra faena.",
      }, OUTSIDER)).rejects.toThrow()
    })

    it("reabrir la inspección conserva el hallazgo derivado y su mantención", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      await service.transitionInspectionRun({
        runId: reporteRunId, expectedVersion: await currentRunVersion(reporteRunId),
        toStatus: "in_progress", reason: "Corregir la lectura del horómetro de término.",
      }, REVIEWER)

      const findings = await getDb().select().from(schema.preventionInspectionFindings)
        .where(eq(schema.preventionInspectionFindings.runId, reporteRunId))
      // El hallazgo ya tiene CAPA: `completeInspectionRun` sólo borra los
      // abiertos sin acción, así que la orden de taller no queda huérfana.
      expect(findings).toHaveLength(1)
      const records = await getDb().select().from(schema.maintenanceRecords)
        .where(eq(schema.maintenanceRecords.inspectionFindingId, findings[0]!.id))
      expect(records).toHaveLength(1)
    })
  })

  /* ── Ingesta: la planilla física y la ratificación de lo leído ─────────── */
  /* ── Catálogo maestro de desviaciones ───────────────────────────────────
   * La razón de existir del catálogo es que quien registra en terreno NO decida
   * la gravedad: la declara el maestro, el instrumento puede ajustarla, y de
   * ahí sale el plazo de la acción correctiva. Lo que se prueba acá es esa
   * garantía, más las dos cosas que el modelo anterior —una lista por fila de
   * plantilla— no podía sostener: sobrevivir a un versionado y apagarse en
   * todos lados a la vez.
   */
  describe("Catálogo maestro de desviaciones", () => {
    async function catalogo() {
      const deviations = await import("@/lib/services/prevention-deviations")
      const service = await import("@/lib/services/prevention-inspections")
      const template = await installTemplate({ definitionCode: "inspeccion_carros", versionLabel: `dev-${Date.now()}` })
      return { deviations, service, template }
    }

    /** Crea una entrada del maestro y la ofrece en un instrumento. */
    async function offer(
      deviations: typeof import("@/lib/services/prevention-deviations"),
      code: string,
      label: string,
      danoPotencial: string,
      override?: string | null,
    ) {
      const entry = await deviations.createMasterDeviation({ label, danoPotencial }, CATALOGER)
      await deviations.setTemplateDeviation(
        { templateCode: code, entryId: entry.id, selected: true, danoPotencialOverride: override ?? null },
        CATALOGER,
      )
      return entry
    }

    it("la gravedad del maestro determina la criticidad del hallazgo, no el criterio de quien registra", async () => {
      const { deviations, template } = await catalogo()
      const entry = await offer(deviations, template.code, `Gancho de tiro con holgura ${Date.now()}`, "grave")

      const offered = await deviations.listOfferedDeviations(template.code)
      // `grave` produce hallazgo `high`, que a su vez fija el plazo en 7 días.
      expect(offered.find((row) => row.id === entry.id)?.criticality).toBe("high")
    })

    it("un instrumento sólo ofrece lo que seleccionó, aunque el maestro sea común", async () => {
      const { deviations, template } = await catalogo()
      const otro = await installTemplate({ definitionCode: "inspeccion_extintores", versionLabel: `dev-otro-${Date.now()}` })
      const label = `Pernos de rueda sueltos ${Date.now()}`
      const entry = await offer(deviations, template.code, label, "grave")

      const deCarros = await deviations.listOfferedDeviations(template.code)
      const deExtintores = await deviations.listOfferedDeviations(otro.code)
      expect(deCarros.map((row) => row.id)).toContain(entry.id)
      expect(deExtintores.map((row) => row.id)).not.toContain(entry.id)
    })

    it("el instrumento puede ajustar la gravedad sin tocar la del maestro", async () => {
      const { deviations, template } = await catalogo()
      const otro = await installTemplate({ definitionCode: "inspeccion_extintores", versionLabel: `ajus-${Date.now()}` })
      const label = `Extintor obstruido ${Date.now()}`
      const entry = await offer(deviations, template.code, label, "moderado", "fatal")
      await deviations.setTemplateDeviation(
        { templateCode: otro.code, entryId: entry.id, selected: true }, CATALOGER,
      )

      const conAjuste = await deviations.listOfferedDeviations(template.code)
      const sinAjuste = await deviations.listOfferedDeviations(otro.code)
      expect(conAjuste.find((row) => row.id === entry.id)?.danoPotencial).toBe("fatal")
      // El que no ajustó hereda la del maestro, y la seguirá heredando.
      expect(sinAjuste.find((row) => row.id === entry.id)?.danoPotencial).toBe("moderado")
    })

    it("no admite la misma desviación dos veces en el maestro", async () => {
      const { deviations } = await catalogo()
      const label = `Luces sin funcionar ${Date.now()}`
      await deviations.createMasterDeviation({ label, danoPotencial: "grave" }, CATALOGER)
      await expect(deviations.createMasterDeviation({ label, danoPotencial: "leve" }, CATALOGER))
        .rejects.toThrow(/ya está en el catálogo/)
    })

    it("recalibrar el maestro rige desde ahora y no reescribe lo ya levantado", async () => {
      const { deviations, template } = await catalogo()
      const entry = await offer(deviations, template.code, `Espejo trizado ${Date.now()}`, "moderado")

      const { after } = await deviations.updateMasterDeviation({ id: entry.id, danoPotencial: "grave" }, CATALOGER)
      expect(after.danoPotencial).toBe("grave")
      // La recalibración se propaga a quien no ajustó, y desde ahora.
      const offered = await deviations.listOfferedDeviations(template.code)
      expect(offered.find((row) => row.id === entry.id)?.criticality).toBe("high")
    })

    it("retirar del maestro la apaga en TODOS los instrumentos a la vez", async () => {
      const { deviations, template } = await catalogo()
      const otro = await installTemplate({ definitionCode: "inspeccion_extintores", versionLabel: `ret-${Date.now()}` })
      const entry = await offer(deviations, template.code, `Neumático con desgaste ${Date.now()}`, "moderado")
      await deviations.setTemplateDeviation(
        { templateCode: otro.code, entryId: entry.id, selected: true }, CATALOGER,
      )

      await deviations.updateMasterDeviation({ id: entry.id, isActive: false }, CATALOGER)

      expect((await deviations.listOfferedDeviations(template.code)).map((r) => r.id)).not.toContain(entry.id)
      expect((await deviations.listOfferedDeviations(otro.code)).map((r) => r.id)).not.toContain(entry.id)
      // Pero la fila sigue ahí: los hallazgos la referencian.
      const [row] = await getDb().select().from(schema.preventionDeviationCatalog)
        .where(eq(schema.preventionDeviationCatalog.id, entry.id))
      expect(row?.isActive).toBe(false)
    })

    it("desmarcar en un instrumento no la apaga en los demás", async () => {
      const { deviations, template } = await catalogo()
      const otro = await installTemplate({ definitionCode: "inspeccion_extintores", versionLabel: `desm-${Date.now()}` })
      const entry = await offer(deviations, template.code, `Cable expuesto ${Date.now()}`, "grave")
      await deviations.setTemplateDeviation(
        { templateCode: otro.code, entryId: entry.id, selected: true }, CATALOGER,
      )

      await deviations.setTemplateDeviation(
        { templateCode: template.code, entryId: entry.id, selected: false }, CATALOGER,
      )

      expect((await deviations.listOfferedDeviations(template.code)).map((r) => r.id)).not.toContain(entry.id)
      expect((await deviations.listOfferedDeviations(otro.code)).map((r) => r.id)).toContain(entry.id)
    })

    /* La regresión que motivó el maestro: el catálogo colgaba de la FILA de la
     * plantilla, y versionar creaba una fila nueva con catálogo vacío. */
    it("versionar el instrumento conserva lo que ofrecía", async () => {
      const { deviations, service, template } = await catalogo()
      const entry = await offer(deviations, template.code, `Barandas sueltas ${Date.now()}`, "grave")
      expect((await deviations.listOfferedDeviations(template.code)).map((r) => r.id)).toContain(entry.id)

      const v2 = await importTemplate(
        { definitionCode: "inspeccion_carros", versionLabel: `v2-${Date.now()}` },
      )
      await service.approveInspectionTemplate({
        templateId: v2.id, expectedVersion: v2.version,
        reason: "Versión nueva del instrumento habilitada en la prueba.",
      }, APPROVER)

      expect(v2.id).not.toBe(template.id)
      expect(v2.code).toBe(template.code)
      // Misma selección, sin copiar nada a mano.
      expect((await deviations.listOfferedDeviations(v2.code)).map((r) => r.id)).toContain(entry.id)
    })

    it("quien sólo ejecuta no puede calibrar el instrumento", async () => {
      const { deviations, template } = await catalogo()
      const entry = await deviations.createMasterDeviation(
        { label: `Desviación no autorizada ${Date.now()}`, danoPotencial: "grave" }, CATALOGER,
      )
      const executor = { ...AUTHOR, permissions: ["prevention:inspections:view", "prevention:inspections:execute"] }
      await expect(deviations.setTemplateDeviation(
        { templateCode: template.code, entryId: entry.id, selected: true }, executor,
      )).rejects.toThrow()
    })

    it("calibrar un instrumento no alcanza para crear entradas del maestro", async () => {
      const { deviations } = await catalogo()
      // AUTHOR tiene `:manage` pero no `admin:deviation_catalog`.
      await expect(deviations.createMasterDeviation(
        { label: `Sin permiso de maestro ${Date.now()}`, danoPotencial: "leve" }, AUTHOR,
      )).rejects.toThrow()
    })
  })


  /* ── Instrumento de desviaciones ────────────────────────────────────────
   * Lo que se prueba es la garantía que justifica todo el diseño: que la
   * gravedad —y con ella el plazo de la acción correctiva— la declare el
   * catálogo y no quien está en terreno. Y que completar la inspección no
   * borre lo que esa persona registró, que es la regresión por la que existe
   * la columna `origin`.
   */
  describe("Registrar desviaciones", () => {
    async function areaRunWithCatalog() {
      const service = await import("@/lib/services/prevention-inspections")
      const deviations = await import("@/lib/services/prevention-deviations")
      const template = await installTemplate({
        definitionCode: "inspeccion_area", kind: "inspection", versionLabel: `area-${Date.now()}`,
      })
      // Etiquetas únicas por corrida: el maestro es global y su índice único es
      // sólo por etiqueta, así que dos fixtures no pueden repetirla.
      const stamp = Date.now()
      const grave = await deviations.promoteUnclassifiedDeviation({
        templateCode: template.code, label: `Vía de evacuación bloqueada ${stamp}`, danoPotencial: "grave",
      }, CATALOGER)
      const leve = await deviations.promoteUnclassifiedDeviation({
        templateCode: template.code, label: `Desorden localizado ${stamp}`, danoPotencial: "leve",
      }, CATALOGER)
      // `createInspectionRun` devuelve `{ run, idempotentReplay }`.
      const { run } = await service.createInspectionRun({
        templateId: template.id, worksiteId: "ws-in-a",
      }, AUTHOR)
      return { service, deviations, template, run, grave, leve }
    }

    async function findingsOf(runId: string) {
      return getDb().select().from(schema.preventionInspectionFindings)
        .where(eq(schema.preventionInspectionFindings.runId, runId))
    }

    it("la desviación del catálogo trae su gravedad: el cliente no la manda", async () => {
      const { service, run, grave } = await areaRunWithCatalog()
      const created = await service.registerDeviation({ runId: run.id, catalogEntryId: grave.id }, AUTHOR)

      expect(created.description).toBe(grave.label)
      // `grave` → `high` → plazo de 7 días en la CAPA.
      expect(created.criticality).toBe("high")
      expect(created.origin).toBe("deviation")
      expect(created.catalogEntryId).toBe(grave.id)
      // Y la inspección deja de estar sólo planificada: registrar es trabajo.
      const [after] = await getDb().select({ status: schema.preventionInspectionRuns.status })
        .from(schema.preventionInspectionRuns).where(eq(schema.preventionInspectionRuns.id, run.id))
      expect(after?.status).toBe("in_progress")
    })

    it("declarar ejecutada NO borra las desviaciones registradas", async () => {
      const { service, run, grave, leve } = await areaRunWithCatalog()
      await service.registerDeviation({ runId: run.id, catalogEntryId: grave.id }, AUTHOR)
      await service.registerDeviation({ runId: run.id, catalogEntryId: leve.id }, AUTHOR)

      const [before] = await getDb().select({ version: schema.preventionInspectionRuns.version })
        .from(schema.preventionInspectionRuns).where(eq(schema.preventionInspectionRuns.id, run.id))
      await service.completeInspectionRun({ runId: run.id, expectedVersion: before!.version }, AUTHOR)

      const findings = await findingsOf(run.id)
      expect(findings).toHaveLength(2)
      // Sin ítems puntuables no hay nada que promediar.
      const [completed] = await getDb().select({ compliancePercent: schema.preventionInspectionRuns.compliancePercent })
        .from(schema.preventionInspectionRuns).where(eq(schema.preventionInspectionRuns.id, run.id))
      expect(completed?.compliancePercent).toBeNull()
    })

    it("reabrir para rectificar tampoco las borra", async () => {
      const { service, run, grave } = await areaRunWithCatalog()
      await service.registerDeviation({ runId: run.id, catalogEntryId: grave.id }, AUTHOR)
      const [pre] = await getDb().select({ version: schema.preventionInspectionRuns.version })
        .from(schema.preventionInspectionRuns).where(eq(schema.preventionInspectionRuns.id, run.id))
      const completed = await service.completeInspectionRun({ runId: run.id, expectedVersion: pre!.version }, AUTHOR)

      await service.transitionInspectionRun({
        runId: run.id, expectedVersion: completed.run.version,
        toStatus: "in_progress", reason: "Se corrige el sector recorrido.",
      }, { ...AUTHOR, permissions: [...AUTHOR.permissions, "prevention:inspections:review"] })

      expect(await findingsOf(run.id)).toHaveLength(1)
    })

    it("«Otra desviación» queda sin catálogo y aparece en la cola de clasificación", async () => {
      const { service, template, run } = await areaRunWithCatalog()
      const created = await service.registerDeviation({
        runId: run.id, description: "Extintor tapado por pallets", danoPotencial: "moderado",
      }, AUTHOR)
      expect(created.catalogEntryId).toBeNull()
      expect(created.criticality).toBe("medium")

      const pendientes = await service.listUnclassifiedDeviationsFor([template.id], AUTHOR)
      expect((pendientes.get(template.id) ?? []).map((row) => row.description))
        .toContain("Extintor tapado por pallets")
    })

    it("una entrada del maestro que este instrumento no ofrece se rechaza", async () => {
      const { service, deviations, run } = await areaRunWithCatalog()
      const otro = await installTemplate({ definitionCode: "caminata_seguridad", versionLabel: `cam-${Date.now()}` })
      const ajena = await deviations.promoteUnclassifiedDeviation({
        templateCode: otro.code, label: `Desviación de otro instrumento ${Date.now()}`, danoPotencial: "grave",
      }, CATALOGER)

      await expect(service.registerDeviation({ runId: run.id, catalogEntryId: ajena.id }, AUTHOR))
        .rejects.toThrow(/no ofrece esa desviación/)
    })

    it("una desmarcada en este instrumento se rechaza", async () => {
      const { service, deviations, template, run, leve } = await areaRunWithCatalog()
      await deviations.setTemplateDeviation(
        { templateCode: template.code, entryId: leve.id, selected: false }, CATALOGER,
      )
      await expect(service.registerDeviation({ runId: run.id, catalogEntryId: leve.id }, AUTHOR))
        .rejects.toThrow(/no ofrece esa desviación/)
    })

    it("una retirada del maestro se rechaza, y el mensaje lo distingue", async () => {
      const { service, deviations, run, leve } = await areaRunWithCatalog()
      await deviations.updateMasterDeviation({ id: leve.id, isActive: false }, CATALOGER)
      await expect(service.registerDeviation({ runId: run.id, catalogEntryId: leve.id }, AUTHOR))
        .rejects.toThrow(/retirada del catálogo/)
    })

    it("el ajuste del instrumento manda sobre la gravedad del maestro", async () => {
      const { service, deviations, template, run, leve } = await areaRunWithCatalog()
      // El maestro la tiene `leve`; acá pesa `fatal`.
      await deviations.setTemplateDeviation(
        { templateCode: template.code, entryId: leve.id, selected: true, danoPotencialOverride: "fatal" },
        CATALOGER,
      )
      const created = await service.registerDeviation({ runId: run.id, catalogEntryId: leve.id }, AUTHOR)
      expect(created.danoPotencial).toBe("fatal")
      expect(created.criticality).toBe("critical")
    })

    it("no se registra en una inspección ya ejecutada", async () => {
      const { service, run, grave, leve } = await areaRunWithCatalog()
      await service.registerDeviation({ runId: run.id, catalogEntryId: grave.id }, AUTHOR)
      const [pre] = await getDb().select({ version: schema.preventionInspectionRuns.version })
        .from(schema.preventionInspectionRuns).where(eq(schema.preventionInspectionRuns.id, run.id))
      await service.completeInspectionRun({ runId: run.id, expectedVersion: pre!.version }, AUTHOR)

      await expect(service.registerDeviation({ runId: run.id, catalogEntryId: leve.id }, AUTHOR))
        .rejects.toThrow(/sigue en ejecución/)
    })

    it("quitar una desviación se puede sin CAPA y no con ella", async () => {
      const { service, run, grave } = await areaRunWithCatalog()
      const created = await service.registerDeviation({ runId: run.id, catalogEntryId: grave.id }, AUTHOR)

      await service.createFindingCapa({
        findingId: created.id, actionDescription: "Despejar la vía y demarcarla.",
        responsibleUserId: AUTHOR.userId,
      }, AUTHOR)
      await expect(service.removeDeviation({ findingId: created.id }, AUTHOR))
        .rejects.toThrow(/acción correctiva/)
    })

    it("derivar una desviación a CAPA le pone el plazo de su criticidad", async () => {
      const { service, run, grave } = await areaRunWithCatalog()
      const created = await service.registerDeviation({ runId: run.id, catalogEntryId: grave.id }, AUTHOR)
      const result = await service.createFindingCapa({
        findingId: created.id, actionDescription: "Despejar la vía de evacuación.",
        responsibleUserId: AUTHOR.userId,
      }, AUTHOR)

      const [capa] = await getDb().select({ targetDate: schema.preventionCapaActions.targetDate, priority: schema.preventionCapaActions.priority })
        .from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, result.capaId))
      // `high` → prioridad alta y 7 días.
      expect(capa?.priority).toBe("high")
      expect(capa?.targetDate).toBeTruthy()
    })

    it("incorporar una «Otra» al maestro la saca de la cola de clasificación", async () => {
      const { service, deviations, template, run } = await areaRunWithCatalog()
      const label = `Extintor sin señalizar ${Date.now()}`
      await service.registerDeviation({ runId: run.id, description: label, danoPotencial: "moderado" }, AUTHOR)

      const antes = await service.listUnclassifiedDeviationsFor([template.id], AUTHOR)
      expect((antes.get(template.id) ?? []).map((row) => row.description)).toContain(label)

      const entry = await deviations.promoteUnclassifiedDeviation(
        { templateCode: template.code, label, danoPotencial: "moderado" }, CATALOGER,
      )
      // Ya se ofrece; el hallazgo viejo sigue en la cola porque su gravedad la
      // eligió una persona y esa evidencia no se reescribe.
      expect((await deviations.listOfferedDeviations(template.code)).map((r) => r.id)).toContain(entry.id)

      // Y lo que se registre de ahora en más ya no cae en la cola.
      const { run: otroRun } = await service.createInspectionRun(
        { templateId: template.id, worksiteId: "ws-in-a" }, AUTHOR,
      )
      const nuevo = await service.registerDeviation({ runId: otroRun.id, catalogEntryId: entry.id }, AUTHOR)
      expect(nuevo.catalogEntryId).toBe(entry.id)
    })

    it("un checklist normal sigue rehaciendo sus hallazgos derivados al completar", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const template = await installTemplate({ definitionCode: "inspeccion_extintores", versionLabel: `der-${Date.now()}` })
      const { run } = await service.createInspectionRun({ templateId: template.id, worksiteId: "ws-in-a" }, AUTHOR)
      const items = service.itemsFromDefinition(template.definitionSnapshot as never)

      const saved = await service.saveInspectionAnswers({
        runId: run.id, expectedVersion: run.version,
        answers: answersForAll(items, (item) => item.countsForCompliance
          // I-05: "no cumple" ya exige motivo, igual que "no aplica"/"regular".
          ? { sectionId: item.sectionId, itemId: item.itemId, result: "non_conforming" as const, comment: "Se detecta el incumplimiento en la revisión." }
          : undefined),
      }, AUTHOR)
      // Extintores declara acta, así que hay que completarla — a diferencia de
      // los instrumentos de desviaciones, que no la tienen.
      await service.completeInspectionRun({
        runId: run.id, expectedVersion: saved.version, closingAct: await closingActFor(template.id),
      }, AUTHOR)

      const derived = await findingsOf(run.id)
      expect(derived.length).toBeGreaterThan(0)
      expect(derived.every((finding) => finding.origin === "derived")).toBe(true)
    })
  })

  /* ── Cierre al completar ────────────────────────────────────────────────
   * El reporte de uso diario lo llena el operador en papel y el supervisor lo
   * transcribe: transcribirlo ES revisarlo, así que cierra sin pasar por
   * revisión independiente. Lo que se prueba es que ese atajo NO se lleve por
   * delante la regla del hallazgo grave.
   */
  describe("Instrumentos que cierran al completar", () => {
    /* El reporte mezcla ítems de conformidad con `number`, `select` y `text`, y
     * el helper genérico responde "Registrado en terreno" en todos — que el
     * horómetro rechaza. Se arma acá igual que en el describe del reporte. */
    function reporteRespuestas(items: InspectionItemSpec[], failBrakes = false) {
      return items
        .filter((item) => item.required || (item.countsForCompliance && fieldKindIsScorable(item.kind)))
        .map((item) => {
          if (!fieldKindIsScorable(item.kind)) {
            return {
              sectionId: item.sectionId,
              itemId: item.itemId,
              result: "recorded" as const,
              value: item.kind === "number" ? "134122" : item.kind === "select" ? "tarde" : "Patio madera",
            }
          }
          if (failBrakes && item.itemId === "freno_servicio") {
            return { sectionId: item.sectionId, itemId: item.itemId, result: "non_conforming" as const, comment: "Pedal esponjoso" }
          }
          return { sectionId: item.sectionId, itemId: item.itemId, result: "conforming" as const, comment: null }
        })
    }

    async function reporteRun(failBrakes = false) {
      const service = await import("@/lib/services/prevention-inspections")
      const template = await installTemplate({
        definitionCode: "reporte_equipos", versionLabel: `cierre-${Date.now()}-${failBrakes ? "f" : "ok"}`,
      })
      const { run } = await service.createInspectionRun({ templateId: template.id, worksiteId: "ws-in-a" }, AUTHOR)
      const items = service.itemsFromDefinition(template.definitionSnapshot as never)
      const saved = await service.saveInspectionAnswers({
        runId: run.id, expectedVersion: run.version, answers: reporteRespuestas(items, failBrakes),
      }, AUTHOR)
      return { service, template, run, saved }
    }

    it("sin hallazgos, el reporte queda cerrado y no entra a la cola de revisión", async () => {
      const { service, template, run, saved } = await reporteRun()
      const completed = await service.completeInspectionRun({
        runId: run.id, expectedVersion: saved.version, closingAct: await closingActFor(template.id),
      }, AUTHOR)

      expect(completed.run.status).toBe("reviewed")
      // Quien transcribió es quien revisó: es literalmente lo que hizo.
      expect(completed.run.reviewedByUserId).toBe(AUTHOR.userId)
      expect(completed.run.reviewedAt).toBeTruthy()
    })

    it("con un hallazgo que exige CAPA, se queda esperando revisión igual", async () => {
      // El freno de servicio es de daño potencial fatal → hallazgo crítico.
      const { service, template, run, saved } = await reporteRun(true)
      const completed = await service.completeInspectionRun({
        runId: run.id, expectedVersion: saved.version, closingAct: await closingActFor(template.id),
      }, AUTHOR)

      // Un reporte con los frenos en falla tiene que caer en la cola de alguien.
      expect(completed.run.status).toBe("completed")
      expect(completed.run.reviewedByUserId).toBeNull()
    })

    it("un instrumento normal sigue exigiendo revisión independiente", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const template = await installTemplate({
        definitionCode: "inspeccion_extintores", versionLabel: `norm-${Date.now()}`,
      })
      const { run } = await service.createInspectionRun({ templateId: template.id, worksiteId: "ws-in-a" }, AUTHOR)
      const items = service.itemsFromDefinition(template.definitionSnapshot as never)
      const saved = await service.saveInspectionAnswers({
        runId: run.id, expectedVersion: run.version, answers: answersForAll(items),
      }, AUTHOR)
      const completed = await service.completeInspectionRun({
        runId: run.id, expectedVersion: saved.version, closingAct: await closingActFor(template.id),
      }, AUTHOR)

      expect(completed.run.status).toBe("completed")
    })
  })

  describe("Ingesta de la planilla física", () => {
    const INGESTOR = { userId: "in-author", scope: scopeA, permissions: [...ALL, "prevention:inspections:ingest"] }
    let ingestaTemplateId = ""
    let ingestaRunId = ""

    it("prepara una ejecución del reporte para la ingesta", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      /* La APROBADA, no una cualquiera: aprobar una versión reemplaza a la
       * anterior del mismo código, así que cualquier otro caso que instale un
       * reporte deja varias filas y sólo una es ejecutable. */
      const [template] = await getDb().select().from(schema.preventionInspectionTemplates)
        .where(and(
          eq(schema.preventionInspectionTemplates.sourceDefinitionCode, "reporte_equipos"),
          eq(schema.preventionInspectionTemplates.status, "approved"),
        ))
      ingestaTemplateId = template!.id
      const { run } = await service.createInspectionRun({
        templateId: ingestaTemplateId, worksiteId: "ws-in-a", subjectVehicleId: "veh-a",
      }, AUTHOR)
      ingestaRunId = run.id
      expect(run.status).toBe("planned")
    })

    it("rechaza adjuntar la planilla sin el permiso de ingesta", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      // AUTHOR tiene execute, manage y view, pero no `:ingest`.
      await expect(service.addRunDocument({
        runId: ingestaRunId, path: "storage/inspection-evidence/x.jpg",
      }, AUTHOR)).rejects.toThrow()
    })

    it("rechaza adjuntar la planilla de una faena ajena", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const outsider = { ...OUTSIDER, permissions: [...ALL, "prevention:inspections:ingest"] }
      await expect(service.addRunDocument({
        runId: ingestaRunId, path: "storage/inspection-evidence/x.jpg",
      }, outsider)).rejects.toThrow()
    })

    it("adjunta la planilla y la devuelve en el detalle", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const created = await service.addRunDocument({
        runId: ingestaRunId,
        path: "storage/inspection-evidence/planilla-03101.jpg",
        caption: "Reporte N° 03101",
      }, INGESTOR)
      expect(created).toMatchObject({ kind: "source_form", uploadedByUserId: "in-author" })
      // Sin detector todavía: se sube sin lectura de máquina.
      expect(created.extraction).toBeNull()

      const detail = await service.getInspectionRunDetail(ingestaRunId, AUTHOR)
      expect(detail?.documents).toHaveLength(1)
      expect(detail?.documents[0]).toMatchObject({ caption: "Reporte N° 03101" })
    })

    it("guarda la marca de ratificación sólo en los ítems fatales", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      await service.saveInspectionAnswers({
        runId: ingestaRunId,
        expectedVersion: await currentRunVersion(ingestaRunId),
        answers: [
          // Lo que "leyó" la máquina: un freno y una bocina, ambos marcados.
          { sectionId: "estado_camion", itemId: "freno_servicio", result: "conforming", needsConfirmation: true },
          { sectionId: "estado_camion", itemId: "bocina", result: "conforming", needsConfirmation: true },
        ],
      }, INGESTOR)

      const rows = await getDb().select().from(schema.preventionInspectionAnswers)
        .where(eq(schema.preventionInspectionAnswers.runId, ingestaRunId))
      const byItem = new Map(rows.map((row) => [row.itemId, row]))
      expect(byItem.get("freno_servicio")!.needsConfirmation).toBe(true)
      // La bocina no es fatal: el servicio descarta la marca para que la puerta
      // no se convierta en un trámite de 28 clics.
      expect(byItem.get("bocina")!.needsConfirmation).toBe(false)
    })

    it("no deja declarar ejecutada la inspección con un fatal sin ratificar", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const [template] = await getDb().select().from(schema.preventionInspectionTemplates)
        .where(eq(schema.preventionInspectionTemplates.id, ingestaTemplateId))
      const items = service.itemsFromDefinition(template!.definitionSnapshot as never)
      const answers = items
        .filter((item) => item.required || (item.countsForCompliance && fieldKindIsScorable(item.kind)))
        .map((item) => {
          if (!fieldKindIsScorable(item.kind)) {
            return {
              sectionId: item.sectionId, itemId: item.itemId, result: "recorded" as const,
              value: item.kind === "number" ? "134122" : item.kind === "select" ? "tarde" : "Patio madera",
            }
          }
          return {
            sectionId: item.sectionId, itemId: item.itemId, result: "conforming" as const,
            // El freno queda pre-llenado por la máquina y sin ratificar.
            needsConfirmation: item.itemId === "freno_servicio",
          }
        })

      await service.saveInspectionAnswers({
        runId: ingestaRunId, expectedVersion: await currentRunVersion(ingestaRunId), answers,
      }, INGESTOR)
      await expect(service.completeInspectionRun({
        runId: ingestaRunId, expectedVersion: await currentRunVersion(ingestaRunId),
        closingAct: await closingActFor(ingestaTemplateId),
      }, AUTHOR)).rejects.toThrow(/de servicio \(pedal de freno\)/i)

      // Ratificado —sin cambiar la respuesta— la subida cierra.
      await service.saveInspectionAnswers({
        runId: ingestaRunId,
        expectedVersion: await currentRunVersion(ingestaRunId),
        answers: answers.map((answer) => ({ ...answer, needsConfirmation: false })),
      }, INGESTOR)
      const done = await service.completeInspectionRun({
        runId: ingestaRunId, expectedVersion: await currentRunVersion(ingestaRunId),
        closingAct: await closingActFor(ingestaTemplateId),
      }, AUTHOR)
      /* El reporte declara `closesOnCompletion`: transcribirlo ES revisarlo, así
       * que sin hallazgos que exijan CAPA queda cerrado de una vez y no entra a
       * la cola de "Esperando revisión". Acá todo cumple, así que cierra. */
      expect(done.run.status).toBe("reviewed")
      expect(done.run.reviewedByUserId).toBe(AUTHOR.userId)
    })

    it("no admite adjuntar a una inspección ya cerrada", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      // Ya quedó cerrada al declararse ejecutada en el caso anterior.
      const [current] = await getDb().select({ status: schema.preventionInspectionRuns.status })
        .from(schema.preventionInspectionRuns)
        .where(eq(schema.preventionInspectionRuns.id, ingestaRunId))
      expect(current?.status).toBe("reviewed")

      await expect(service.addRunDocument({
        runId: ingestaRunId, path: "storage/inspection-evidence/tarde.jpg",
      }, INGESTOR)).rejects.toThrow(/cerrada o cancelada/i)
    })
  })

  /**
   * INS-03 (auditoría 2026-08-27): la evidencia cuelga de la respuesta con
   * `ON DELETE cascade`, y `saveAnswersWithClient` borra toda respuesta que no
   * venga en el payload. Dejar un ítem en "Sin responder" —o vaciar el campo de
   * uno que no puntúa, que pone el resultado en "" solo— destruía sus
   * fotografías sin preguntar. Con autoguardado eso pasaría sin que nadie
   * pulse un botón, de ahí que la guarda esté en el servidor.
   */
  describe("La evidencia no se borra por dejar un ítem sin responder", () => {
    let evidenceRunId = ""
    let evidenceTemplateId = ""
    let firstItem: InspectionItemSpec | undefined

    it("prepara una inspección con una respuesta y su fotografía", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      const [template] = await getDb().select().from(schema.preventionInspectionTemplates)
        .where(and(
          eq(schema.preventionInspectionTemplates.sourceDefinitionCode, "inspeccion_taller"),
          eq(schema.preventionInspectionTemplates.status, "approved"),
        ))
      evidenceTemplateId = template!.id
      const items = service.itemsFromDefinition(template!.definitionSnapshot as never)
      firstItem = items.find((item) => fieldKindIsScorable(item.kind))
      expect(firstItem).toBeDefined()

      const { run } = await service.createInspectionRun({
        templateId: evidenceTemplateId, worksiteId: "ws-in-a",
      }, AUTHOR)
      evidenceRunId = run.id

      await service.saveInspectionAnswers({
        runId: evidenceRunId,
        expectedVersion: await currentRunVersion(evidenceRunId),
        answers: [{ sectionId: firstItem!.sectionId, itemId: firstItem!.itemId, result: "conforming" }],
      }, AUTHOR)

      const [answer] = await getDb().select().from(schema.preventionInspectionAnswers)
        .where(eq(schema.preventionInspectionAnswers.runId, evidenceRunId))
      await service.addAnswerEvidence({
        answerId: answer!.id,
        path: "storage/inspection-evidence/hallazgo.jpg",
      }, AUTHOR)

      const evidence = await getDb().select().from(schema.preventionInspectionAnswerEvidence)
        .where(eq(schema.preventionInspectionAnswerEvidence.answerId, answer!.id))
      expect(evidence).toHaveLength(1)
    })

    it("rechaza el guardado que dejaría el ítem sin responder, nombrando lo que se perdería", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      await expect(service.saveInspectionAnswers({
        runId: evidenceRunId,
        expectedVersion: await currentRunVersion(evidenceRunId),
        // El conjunto completo llega vacío: es lo que manda el formulario
        // cuando alguien devuelve el único ítem respondido a "Sin responder".
        answers: [],
      }, AUTHOR)).rejects.toThrow(/se perdería la evidencia adjunta/i)
    })

    it("y la fotografía sigue ahí después del rechazo", async () => {
      const rows = await getDb().select().from(schema.preventionInspectionAnswerEvidence)
        .innerJoin(
          schema.preventionInspectionAnswers,
          eq(schema.preventionInspectionAnswers.id, schema.preventionInspectionAnswerEvidence.answerId),
        )
        .where(eq(schema.preventionInspectionAnswers.runId, evidenceRunId))
      expect(rows).toHaveLength(1)
    })

    it("sigue permitiendo cambiar la respuesta del ítem: lo que se guarda es no responderlo", async () => {
      const service = await import("@/lib/services/prevention-inspections")
      await expect(service.saveInspectionAnswers({
        runId: evidenceRunId,
        expectedVersion: await currentRunVersion(evidenceRunId),
        answers: [{
          sectionId: firstItem!.sectionId,
          itemId: firstItem!.itemId,
          result: "non_conforming",
          comment: "Extintor descargado.",
        }],
      }, AUTHOR)).resolves.toBeDefined()

      const rows = await getDb().select().from(schema.preventionInspectionAnswerEvidence)
        .innerJoin(
          schema.preventionInspectionAnswers,
          eq(schema.preventionInspectionAnswers.id, schema.preventionInspectionAnswerEvidence.answerId),
        )
        .where(eq(schema.preventionInspectionAnswers.runId, evidenceRunId))
      expect(rows).toHaveLength(1)
    })
  })
})

/** Las migraciones crean la tabla de categorías pero no la pueblan. */
const SST_CATEGORY = "fixture-inspecciones"

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.sstDocumentCategories).values({
    slug: SST_CATEGORY, name: "Respaldo documental de las pruebas", createdAt: now, updatedAt: now,
  })
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
  // Padrón de flota: sujeto del Reporte de Equipos y destino de la mantención.
  // Slug propio: las migraciones ya siembran la taxonomía real (`camion`, …) y
  // `fuel_equipment_types_slug_unique` no admite repetirlo.
  await database.insert(schema.fuelEquipmentTypes).values([
    { id: "eqt-in-camion", slug: "camion_fixture_inspecciones", name: "Camión (fixture)", category: "truck", defaultMeterType: "hour_meter", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.fuelVehicles).values([
    { id: "veh-a", plate: "ABCD12", code: "KA-122", type: "camion", equipmentTypeId: "eqt-in-camion", meterType: "hour_meter", worksiteId: "ws-in-a", createdAt: now, updatedAt: now },
    { id: "veh-b", plate: "WXYZ99", code: "KA-999", type: "camion", equipmentTypeId: "eqt-in-camion", meterType: "hour_meter", worksiteId: "ws-in-b", createdAt: now, updatedAt: now },
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

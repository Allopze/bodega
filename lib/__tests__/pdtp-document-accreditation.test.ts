/**
 * lib/__tests__/pdtp-document-accreditation.test.ts
 *
 * Documentación que acredita o dispara actividades del PDTP (decisión del
 * 2026-09-24). Tres cosas, con Postgres real (PGlite) y los servicios reales:
 *
 * 1. Un tipo que no requiere aprobación (un registro externo) deja la versión
 *    vigente al cargarla, sin marcarla como "publicada sin aprobador"; el RIOHS
 *    nunca toma ese atajo.
 * 2. La carpeta de requisitos legales (N°19) acredita el mes planificado cuando
 *    la faena tiene vigentes todos los tipos que la actividad declara —y no
 *    antes, ni con una carta anterior al RIOHS vigente—.
 * 3. Una versión vigente del RIOHS abre por faena la entrega N°18 a toda la
 *    dotación (30 días), que se reporta sola cuando la dotación acusa o queda
 *    exenta, y cuenta en el indicador como un caso propio.
 */
import path from "node:path"
import { mkdtempSync, promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { RIOHS_SECTION_IDS } from "@/lib/prevention/riohs"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const tmpStorageDir = mkdtempSync(join(tmpdir(), "pdtp-doc-accreditation-"))
vi.mock("@/lib/storage/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/storage/config")>()
  return {
    ...original,
    resolveSstDocumentsDir: () => tmpStorageDir,
    createSstDocumentPath: (name: string, segments?: readonly string[]) =>
      `storage/sst-documents/${[...(segments ?? []), name].join("/")}`,
    resolveSstDocumentFile: (filePath: string) => join(tmpStorageDir, filePath.replace(/^storage\/sst-documents\//, "")),
  }
})
vi.mock("@/lib/storage/helpers", () => ({
  mkdirp: async (dir: string) => fs.mkdir(dir, { recursive: true }),
  writeBuffer: async (filePath: string, buffer: Buffer) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, buffer)
  },
  readBuffer: async (filePath: string) => fs.readFile(filePath),
  removeFile: async (filePath: string) => fs.unlink(filePath).catch(() => undefined),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const documents = await import("@/lib/services/prevention-documents-library")
const { seedDefaultCategories } = documents
const { sweepPdtpLegalFolders, evaluatePdtpLegalFolder } = await import("@/lib/services/pdtp-adapters/legal-folder-connector")
const { setPdtpActivityDocumentRequirements } = await import("@/lib/services/pdtp/document-requirements")
const { approvePdtpExecution } = await import("@/lib/services/pdtp/executions")
const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
  await fs.rm(tmpStorageDir, { recursive: true, force: true })
})

const { year: YEAR, month: MONTH } = chileDateParts()
const PROGRAM_ID = "pdtp-docs-v1"
const WS_A = "ws-docs-a"
const WS_B = "ws-docs-b"
const UPLOADER = "user-docs-uploader"
const REVIEWER = "user-docs-reviewer"
const APPROVER = "user-docs-approver"
const JDPR = "user-docs-jdpr"
const FOLDER_ACTIVITY = `${PROGRAM_ID}-a-019`
const RIOHS_ACTIVITY = `${PROGRAM_ID}-a-018`
const TYPE = {
  riohs: "sstdt-legal_normativa-riohs",
  seremi: "sstdt-legal_normativa-riohs-seremi",
  dt: "sstdt-legal_normativa-riohs-dt",
  irl: "sstdt-capacitacion-irl-reg",
  epp: "sstdt-epp-epp-reg",
  pts: "sstdt-gestion_preventiva-pts",
}
const ALL: WorksiteScope = { mode: "all", ids: [] }
const PERMISSIONS = ["prevention:docs:manage", "prevention:docs:publish", "prevention:docs:distribute", "prevention:docs:ack"]

let fileSeq = 0
/** Un PDF mínimo distinto cada vez: dos versiones del mismo documento no pueden repetir checksum. */
function pdf(name: string) {
  fileSeq += 1
  const buffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, ...new TextEncoder().encode(`${name}-${fileSeq}`)])
  return { name: `${name}.pdf`, type: "application/pdf", size: buffer.byteLength, buffer }
}

function ctx(userId: string) {
  return { ctx: { userId }, scope: ALL, permissions: PERMISSIONS }
}

async function createTyped(input: { typeId: string; worksiteId: string | null; title: string; extraMetadata?: Record<string, unknown> }) {
  const [type] = await inMemoryDb.select().from(schema.sstDocumentTypes).where(eq(schema.sstDocumentTypes.id, input.typeId))
  return documents.createDocument({
    data: {
      categorySlug: type!.categorySlug,
      typeId: input.typeId,
      title: input.title,
      worksiteId: input.worksiteId ?? "",
      dataClass: "operational",
      tags: [],
      extraMetadata: input.extraMetadata ?? {},
    },
    ...ctx(UPLOADER),
  })
}

async function upload(documentId: string, name: string, extra: { effectiveFrom?: string } = {}) {
  return documents.uploadDocumentVersion({ input: { documentId, file: pdf(name), ...extra }, ...ctx(UPLOADER) })
}

/** Ciclo completo segregado: carga, revisión, aprobación y publicación por personas distintas. */
async function publishThroughWorkflow(documentId: string, name: string) {
  const version = await upload(documentId, name)
  await documents.submitDocumentVersionForReview({ versionId: version.id, ...ctx(UPLOADER) })
  await documents.markDocumentVersionReviewed({ versionId: version.id, ...ctx(REVIEWER) })
  await documents.approveDocumentVersion({ versionId: version.id, ...ctx(APPROVER) })
  await documents.publishDocumentVersion({ versionId: version.id, ...ctx(UPLOADER) })
  return version
}

const riohsMetadata = { riohsSections: [...RIOHS_SECTION_IDS] }

beforeEach(async () => {
  await pg.exec(`TRUNCATE TABLE users, worksites, sst_document_categories, pdtp_programs RESTART IDENTITY CASCADE`)
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values([UPLOADER, REVIEWER, APPROVER, JDPR].map((id) => ({
    id, name: id, email: `${id}@example.test`, hashedPassword: "x",
  })))
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena Norte", code: "FN", isActive: true },
    { id: WS_B, name: "Faena Sur", code: "FS", isActive: true },
  ])
  await seedDefaultCategories()

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: YEAR, title: `PDTP ${YEAR} documentación`,
    status: "active", appliesToAllWorksites: true, activatedByUserId: JDPR,
    elaboratedByName: "Prevención", elaboratedByTitle: "Prevencionista",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values([
    {
      id: FOLDER_ACTIVITY, programId: PROGRAM_ID, n: 19,
      activity: "Mantener carpetas de requisitos legales", program: "Carpeta de arranque",
      responsibleSlugs: ["prf"], responsibleDisplay: "PRF",
      scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
      mechanism: "enganche", indicatorMode: "planned_vs_completed",
      sourceSheetRow: 30, createdAt: now, updatedAt: now,
    },
    {
      id: RIOHS_ACTIVITY, programId: PROGRAM_ID, n: 18,
      activity: "Entregar y capacitar sobre el reglamento interno", program: "RIOHS",
      responsibleSlugs: ["prf"], responsibleDisplay: "PRF",
      scheduleMode: "on_demand", scheduleClassificationStatus: "confirmed",
      mechanism: "compuesta", indicatorMode: "coverage", subjectSource: "trabajadores_nuevos",
      dueDays: 0, evidenceRequirement: "Entrega del RIOHS registrada.",
      sourceSheetRow: 29, createdAt: now, updatedAt: now,
    },
  ])
  // La N°19 se planifica todos los meses en la semana 2, como en el catálogo.
  await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
    id: `${FOLDER_ACTIVITY}-s-${YEAR}-${MONTH}-2`, activityId: FOLDER_ACTIVITY,
    year: YEAR, month: MONTH, week: 2, plannedQuantity: 1, sourceColumn: "test",
  })
})

describe("carga directa de registros externos", () => {
  it("un tipo sin aprobación queda vigente al cargarlo y no figura como publicado sin aprobador", async () => {
    const doc = await createTyped({ typeId: TYPE.seremi, worksiteId: null, title: "Carta SEREMI" })
    const version = await upload(doc.id, "carta-seremi")
    expect(version).toMatchObject({ status: "vigente", approvalMode: "not_required" })
    const [stored] = await inMemoryDb.select().from(schema.sstDocuments).where(eq(schema.sstDocuments.id, doc.id))
    expect(stored).toMatchObject({ status: "vigente", currentVersionId: version.id, categorySlug: "legal_normativa" })

    // Una segunda carga reemplaza a la vigente, por el mismo paso que publicar.
    const second = await upload(doc.id, "carta-seremi-2")
    const [first] = await inMemoryDb.select().from(schema.sstDocumentVersions).where(eq(schema.sstDocumentVersions.id, version.id))
    expect(first?.status).toBe("reemplazado")
    expect(second.status).toBe("vigente")

    const findings = await documents.getDocumentIntegrityFindings(ALL, PERMISSIONS)
    expect(findings.filter((finding) => finding.documentId === doc.id)).toEqual([])
  })

  it("un tipo con validez calcula el vencimiento de la versión vigente", async () => {
    const doc = await createTyped({ typeId: TYPE.irl, worksiteId: WS_A, title: "IRL Faena Norte" })
    await upload(doc.id, "irl", { effectiveFrom: `${YEAR}-01-15` })
    const [stored] = await inMemoryDb.select().from(schema.sstDocuments).where(eq(schema.sstDocuments.id, doc.id))
    expect(stored?.expiresAt).toBe(`${YEAR + 1}-01-15`)
  })

  it("el RIOHS nunca queda vigente al cargarlo, aunque su tipo se configurara sin aprobación", async () => {
    await inMemoryDb.update(schema.sstDocumentTypes).set({ requiresApproval: false }).where(eq(schema.sstDocumentTypes.id, TYPE.riohs))
    const doc = await createTyped({ typeId: TYPE.riohs, worksiteId: null, title: "RIOHS", extraMetadata: riohsMetadata })
    const version = await upload(doc.id, "riohs")
    expect(version.status).toBe("borrador")
  })

  it("un documento sin clasificar sigue el ciclo de siempre", async () => {
    const doc = await documents.createDocument({
      data: { categorySlug: "gestion_preventiva", title: "Sin tipo", dataClass: "operational", tags: [], extraMetadata: {} },
      ...ctx(UPLOADER),
    })
    expect((await upload(doc.id, "sin-tipo")).status).toBe("borrador")
  })
})

describe("carpeta de requisitos legales (N°19)", () => {
  async function declareFolder() {
    // La carpeta se declara con el programa editable; acá se inserta directo
    // porque el programa del fixture ya está activo.
    await inMemoryDb.insert(schema.pdtpActivityDocumentRequirements).values([
      { id: "req-riohs", activityId: FOLDER_ACTIVITY, documentTypeId: TYPE.riohs, scope: "corporativo", displayOrder: 0 },
      { id: "req-seremi", activityId: FOLDER_ACTIVITY, documentTypeId: TYPE.seremi, scope: "corporativo", mustFollowDocumentTypeId: TYPE.riohs, displayOrder: 1 },
      { id: "req-irl", activityId: FOLDER_ACTIVITY, documentTypeId: TYPE.irl, scope: "faena", displayOrder: 2 },
    ].map((row) => ({ ...row, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })))
  }

  async function folderExecutions(worksiteId?: string) {
    return inMemoryDb.select().from(schema.pdtpExecutions).where(and(
      eq(schema.pdtpExecutions.activityId, FOLDER_ACTIVITY),
      worksiteId ? eq(schema.pdtpExecutions.worksiteId, worksiteId) : undefined,
    ))
  }

  it("acredita el mes planificado de la faena cuando todos los documentos quedan vigentes", async () => {
    await declareFolder()
    const riohs = await createTyped({ typeId: TYPE.riohs, worksiteId: null, title: "RIOHS", extraMetadata: riohsMetadata })
    await publishThroughWorkflow(riohs.id, "riohs")
    const seremi = await createTyped({ typeId: TYPE.seremi, worksiteId: null, title: "Carta SEREMI" })
    await upload(seremi.id, "carta")
    // Falta el IRL de la faena: nada que acreditar todavía.
    expect(await folderExecutions()).toHaveLength(0)

    const irl = await createTyped({ typeId: TYPE.irl, worksiteId: WS_A, title: "IRL Norte" })
    await upload(irl.id, "irl-norte")

    const executions = await folderExecutions()
    // Sólo la Faena Norte completó su carpeta: la Sur no tiene su IRL.
    expect(executions).toHaveLength(1)
    expect(executions[0]).toMatchObject({
      worksiteId: WS_A,
      sourceType: "carpeta_legal",
      status: "submitted",
      year: YEAR,
      month: MONTH,
      week: 2,
    })
    expect(executions[0]!.evidenceText).toContain("Carpeta de requisitos legales completa")

    // Reevaluar el mismo mes no suma otra ejecución.
    await sweepPdtpLegalFolders()
    expect(await folderExecutions(WS_A)).toHaveLength(1)
  })

  it("una carta anterior al RIOHS vigente no cuenta", async () => {
    await declareFolder()
    const seremi = await createTyped({ typeId: TYPE.seremi, worksiteId: null, title: "Carta SEREMI" })
    await upload(seremi.id, "carta", { effectiveFrom: `${YEAR}-01-02` })
    const riohs = await createTyped({ typeId: TYPE.riohs, worksiteId: null, title: "RIOHS", extraMetadata: riohsMetadata })
    await publishThroughWorkflow(riohs.id, "riohs")
    const irl = await createTyped({ typeId: TYPE.irl, worksiteId: WS_A, title: "IRL Norte" })
    await upload(irl.id, "irl-norte")

    const assessment = await evaluatePdtpLegalFolder({ activityId: FOLDER_ACTIVITY, worksiteId: WS_A })
    expect(assessment.items.find((item) => item.requirement.documentTypeId === TYPE.seremi)?.state).toBe("desactualizado")
    expect(assessment.complete).toBe(false)
    expect(await folderExecutions()).toHaveLength(0)
  })

  it("un documento por faena no lo cubre uno corporativo ni el de otra faena", async () => {
    await declareFolder()
    const corporateIrl = await createTyped({ typeId: TYPE.irl, worksiteId: null, title: "IRL corporativo" })
    await upload(corporateIrl.id, "irl-corp")
    const otherIrl = await createTyped({ typeId: TYPE.irl, worksiteId: WS_B, title: "IRL Sur" })
    await upload(otherIrl.id, "irl-sur")
    const assessment = await evaluatePdtpLegalFolder({ activityId: FOLDER_ACTIVITY, worksiteId: WS_A })
    expect(assessment.items.find((item) => item.requirement.documentTypeId === TYPE.irl)?.state).toBe("falta")
  })

  it("el barrido acredita un mes sin cargas si la carpeta ya está completa", async () => {
    // Documentos cargados antes de que existiera la carpeta: ningún evento de
    // carga la evalúa, y sin el barrido el mes quedaría sin acreditar.
    const riohs = await createTyped({ typeId: TYPE.riohs, worksiteId: null, title: "RIOHS", extraMetadata: riohsMetadata })
    await publishThroughWorkflow(riohs.id, "riohs")
    const seremi = await createTyped({ typeId: TYPE.seremi, worksiteId: null, title: "Carta SEREMI" })
    await upload(seremi.id, "carta")
    const irl = await createTyped({ typeId: TYPE.irl, worksiteId: WS_A, title: "IRL Norte" })
    await upload(irl.id, "irl-norte")
    expect(await folderExecutions()).toHaveLength(0)

    await declareFolder()
    const counts = await sweepPdtpLegalFolders()
    expect(counts).toMatchObject({ accredited: 1, incomplete: 1 })
    expect(await folderExecutions(WS_A)).toHaveLength(1)
  })

  it("sin programa activo no evalúa nada", async () => {
    await declareFolder()
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" }).where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    const irl = await createTyped({ typeId: TYPE.irl, worksiteId: WS_A, title: "IRL Norte" })
    await upload(irl.id, "irl-norte")
    expect(await sweepPdtpLegalFolders()).toMatchObject({ accredited: 0 })
    expect(await folderExecutions()).toHaveLength(0)
  })

  it("la carpeta sólo se declara en la actividad de carpeta y con el programa editable", async () => {
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" }).where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    await expect(setPdtpActivityDocumentRequirements({
      programId: PROGRAM_ID, activityId: RIOHS_ACTIVITY, userId: JDPR,
      requirements: [{ documentTypeId: TYPE.irl, scope: "faena" }],
    })).rejects.toThrow(/carpeta de requisitos legales/)

    await setPdtpActivityDocumentRequirements({
      programId: PROGRAM_ID, activityId: FOLDER_ACTIVITY, userId: JDPR,
      requirements: [{ documentTypeId: TYPE.irl, scope: "faena" }, { documentTypeId: TYPE.epp, scope: "faena" }],
    })
    const rows = await inMemoryDb.select().from(schema.pdtpActivityDocumentRequirements)
      .where(eq(schema.pdtpActivityDocumentRequirements.activityId, FOLDER_ACTIVITY))
    expect(rows.map((row) => row.documentTypeId).sort()).toEqual([TYPE.epp, TYPE.irl].sort())

    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "active" }).where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    await expect(setPdtpActivityDocumentRequirements({
      programId: PROGRAM_ID, activityId: FOLDER_ACTIVITY, userId: JDPR, requirements: [],
    })).rejects.toThrow()
  })
})

describe("entrega de una versión del RIOHS a la dotación (N°18)", () => {
  const WORKER_WITH_ACCOUNT = "wk-docs-account"
  const WORKER_NO_ACCOUNT = "wk-docs-talana"
  const ACK_USER = "user-docs-worker"

  beforeEach(async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.workers).values([
      { id: WORKER_WITH_ACCOUNT, rut: "11111111-1", firstName: "Con", lastName: "Cuenta", worksiteId: WS_A, isActive: true, createdAt: now },
      { id: WORKER_NO_ACCOUNT, rut: "22222222-2", firstName: "Sin", lastName: "Cuenta", worksiteId: WS_A, isActive: true, createdAt: now },
    ])
    await inMemoryDb.insert(schema.users).values({
      id: ACK_USER, name: "Con Cuenta", email: "worker@example.test", hashedPassword: "x", workerId: WORKER_WITH_ACCOUNT,
    })
  })

  async function rolloutObligations() {
    return inMemoryDb.select().from(schema.pdtpObligations).where(eq(schema.pdtpObligations.activityId, RIOHS_ACTIVITY))
  }

  it("publicar un RIOHS corporativo abre la entrega en cada faena con dotación, a 30 días, y asigna a la dotación", async () => {
    const riohs = await createTyped({ typeId: TYPE.riohs, worksiteId: null, title: "RIOHS", extraMetadata: riohsMetadata })
    const version = await publishThroughWorkflow(riohs.id, "riohs")

    const obligations = await rolloutObligations()
    // La Faena Sur no tiene dotación: no hay a quién entregar.
    expect(obligations).toHaveLength(1)
    const [obligation] = obligations
    expect(obligation).toMatchObject({ worksiteId: WS_A, status: "pending", sourceType: "documento", sourceId: `riohs:${version.id}` })
    const days = (new Date(obligation!.dueAt!).getTime() - new Date(obligation!.sourceOccurredAt!).getTime()) / 86_400_000
    expect(Math.round(days)).toBe(30)

    const targets = await inMemoryDb.select().from(schema.sstDocumentDistributionTargets)
      .where(eq(schema.sstDocumentDistributionTargets.versionId, version.id))
    expect(targets.map((target) => target.workerId).sort()).toEqual([WORKER_NO_ACCOUNT, WORKER_WITH_ACCOUNT].sort())
  })

  it("se reporta sola cuando la dotación acusa o queda exenta, y cuenta como caso a tiempo al aprobarse", async () => {
    const riohs = await createTyped({ typeId: TYPE.riohs, worksiteId: null, title: "RIOHS", extraMetadata: riohsMetadata })
    const version = await publishThroughWorkflow(riohs.id, "riohs")

    await documents.acknowledgeDocumentVersion({ versionId: version.id, ...ctx(ACK_USER) })
    expect((await rolloutObligations())[0]?.status).toBe("pending")

    const [pendingTarget] = await inMemoryDb.select().from(schema.sstDocumentDistributionTargets).where(and(
      eq(schema.sstDocumentDistributionTargets.versionId, version.id),
      eq(schema.sstDocumentDistributionTargets.status, "pendiente"),
    ))
    const result = await documents.exemptDocumentDistributionTargets({
      versionId: version.id,
      targetIds: [pendingTarget!.id],
      reason: "Entregado por Talana; sin cuenta en la plataforma",
      ...ctx(UPLOADER),
    })
    expect(result).toMatchObject({ exempted: 1, rolloutsReported: 1 })

    const [reported] = await rolloutObligations()
    expect(reported?.status).toBe("reported")
    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
      .where(eq(schema.pdtpExecutions.obligationId, reported!.id))
    expect(execution).toMatchObject({ status: "submitted" })
    expect(execution!.evidenceText).toContain("1 acuse(s) y 1 exención(es)")

    await approvePdtpExecution(execution!.id, JDPR, "all")
    const dueMonth = chileDateParts(reported!.dueAt!).month
    const indicators = await getPdtpComplianceIndicators(PROGRAM_ID, WS_A)
    // La entrega es un caso propio de la N°18, a tiempo. La ejecución que la
    // cierra no infla el padrón de trabajadores nuevos.
    expect(indicators?.monthly[dueMonth - 1]).toMatchObject({ planned: 1, executed: 1 })
  })

  it("en la N°18 sólo cuenta como caso la obligación que lo declara, no cualquier obligación de cobertura", async () => {
    // Una obligación de otro conector sobre la misma actividad (una brecha de
    // capacitación, por ejemplo) no suma: su sujeto ya está en el padrón.
    const now = new Date().toISOString()
    const month = chileDateParts(now).month
    // El mes ya tiene la celda de la N°19 del fixture: se compara antes y después.
    const before = await getPdtpComplianceIndicators(PROGRAM_ID, WS_A)
    await inMemoryDb.insert(schema.pdtpObligations).values({
      id: "obl-sin-marca", programId: PROGRAM_ID, activityId: RIOHS_ACTIVITY, worksiteId: WS_A,
      mode: "on_demand", status: "pending", dueAt: now, idempotencyKey: "obl-sin-marca",
      origin: "integration", sourceType: "capacitacion_ocurrencia", sourceId: "brecha-1",
      sourceMetadataJson: { subjectKey: "occurrence:1" }, createdAt: now, updatedAt: now,
    })
    const after = await getPdtpComplianceIndicators(PROGRAM_ID, WS_A)
    expect(after?.monthly[month - 1]?.planned).toBe(before?.monthly[month - 1]?.planned)
    expect(after?.annual.planned).toBe(before?.annual.planned)
  })

  it("una versión nueva cancela la entrega pendiente de la anterior y abre la suya", async () => {
    const riohs = await createTyped({ typeId: TYPE.riohs, worksiteId: null, title: "RIOHS", extraMetadata: riohsMetadata })
    const v1 = await publishThroughWorkflow(riohs.id, "riohs-v1")
    const v2 = await publishThroughWorkflow(riohs.id, "riohs-v2")

    const obligations = await rolloutObligations()
    expect(obligations.find((row) => row.sourceId === `riohs:${v1.id}`)?.status).toBe("cancelled")
    expect(obligations.find((row) => row.sourceId === `riohs:${v2.id}`)?.status).toBe("pending")
  })

  it("quien opera una faena puede abrir y acusar un RIOHS corporativo", async () => {
    const riohs = await createTyped({ typeId: TYPE.riohs, worksiteId: null, title: "RIOHS", extraMetadata: riohsMetadata })
    const version = await publishThroughWorkflow(riohs.id, "riohs")
    const scoped = { mode: "some" as const, ids: [WS_A] }
    const bundle = await documents.getDocumentBundle(riohs.id, scoped, PERMISSIONS)
    expect(bundle?.doc.id).toBe(riohs.id)
    await expect(documents.acknowledgeDocumentVersion({
      versionId: version.id, ctx: { userId: ACK_USER }, scope: { mode: "some", ids: [WS_B] }, permissions: PERMISSIONS,
    })).resolves.toBeTruthy()
  })
})

describe("la carpeta como contenido firmado del programa", () => {
  it("entra a la huella desde el esquema 19, sin alterar las huellas anteriores", async () => {
    const { buildPdtpProgramContentSnapshot } = await import("@/lib/services/pdtp/content-digest")
    await inMemoryDb.insert(schema.pdtpActivityDocumentRequirements).values({
      id: "req-snap", activityId: FOLDER_ACTIVITY, documentTypeId: TYPE.irl, scope: "faena", displayOrder: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    type Shape = { documentRequirements?: Array<Record<string, unknown>> }
    const v18 = await buildPdtpProgramContentSnapshot(PROGRAM_ID, undefined, { schemaVersion: 18 }) as unknown as Shape
    const v19 = await buildPdtpProgramContentSnapshot(PROGRAM_ID, undefined, { schemaVersion: 19 }) as unknown as Shape
    expect("documentRequirements" in v18).toBe(false)
    expect(v19.documentRequirements).toEqual([expect.objectContaining({ activityNumber: 19, documentTypeId: TYPE.irl, scope: "faena" })])
  })

  it("una N°19 sin documentos declarados bloquea el envío a revisión", async () => {
    const { getPdtpLegalFolderBlockers } = await import("@/lib/services/pdtp/lifecycle")
    const activities = await inMemoryDb.select().from(schema.pdtpActivities).where(eq(schema.pdtpActivities.programId, PROGRAM_ID))
    expect(await getPdtpLegalFolderBlockers(activities)).toEqual([
      expect.stringContaining("no declara qué documentos debe contener"),
    ])
    await inMemoryDb.insert(schema.pdtpActivityDocumentRequirements).values({
      id: "req-gate", activityId: FOLDER_ACTIVITY, documentTypeId: TYPE.irl, scope: "faena", displayOrder: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    expect(await getPdtpLegalFolderBlockers(activities)).toEqual([])
  })
})

/**
 * Ejecución del programa (F2, Task 6): registros «Se hizo / No se hizo» de sólo
 * inserción, anulación con motivo, evidencia del dominio `miper` y avance
 * derivado. La autorización del §6.3 se prueba con las tres personas reales:
 * quien tiene `program:execute`, el responsable nominal y un tercero.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const execution = await import("@/lib/services/miper/program-execution")
const { getProgramWorkspace } = await import("@/lib/services/miper/program-queries")
const evidenceAccess = await import("@/lib/services/miper/evidence-access")

const WS = "ws-exec"
const MATRIX = "mx-exec"
const PROGRAM = "prog-exec"
const ACTION = "act-exec"
const EVIDENCE_PATH = "storage/miper-evidence/acta-de-inspeccion.pdf"

const scope = { mode: "some" as const, ids: [WS] }
const execAccess = { userId: "u-exec", scope, permissions: ["prevention:risk:view", "prevention:risk:program:execute"] }
const nominalAccess = { userId: "u-nominal", scope, permissions: ["prevention:risk:view"] }
const otherAccess = { userId: "u-other", scope, permissions: ["prevention:risk:view", "prevention:risk:edit"] }

const recordsOf = (occurrenceId: string) => testDb.select().from(schema.preventionRiskProgramOccurrenceRecords)
  .where(eq(schema.preventionRiskProgramOccurrenceRecords.occurrenceId, occurrenceId))
const occurrenceOf = async (id: string) => (await testDb.select().from(schema.preventionRiskProgramOccurrences).where(eq(schema.preventionRiskProgramOccurrences.id, id)))[0]!

let notDoneRecordId = ""
let nominalRecordId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Ejecución", code: "EXEC" })
  await testDb.insert(schema.users).values([
    { id: "u-exec", name: "Prevencionista", email: "exec@exec.cl", hashedPassword: "x", isActive: true },
    { id: "u-nominal", name: "Supervisor nominal", email: "nominal@exec.cl", hashedPassword: "x", isActive: true },
    { id: "u-other", name: "Otra persona", email: "other@exec.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.preventionRiskMethodologies).values({
    id: "m-exec", code: "RE-04-CHOME", name: "RE-04", versionLabel: "REV-2026", kind: "primary", authoritySource: "RE-04", createdByUserId: "u-exec",
  })
  await testDb.insert(schema.preventionRiskMatrices).values({
    id: MATRIX, worksiteId: WS, matrixVersion: 1, title: "MIPER Ejecución 2026", period: 2026, status: "published",
    reviewedByUserId: "u-exec", approvedByUserId: "u-exec", publishedByUserId: "u-exec", publishedAt: new Date().toISOString(),
    methodologyId: "m-exec", methodologySnapshot: {}, revisionReason: "Elaboración inicial.", participationSummary: "", consultationEvidenceReference: "", createdByUserId: "u-exec",
  })
  await testDb.insert(schema.preventionRiskPrograms).values({
    id: PROGRAM, matrixId: MATRIX, worksiteId: WS, period: 2026, createdByUserId: "u-exec",
  })
  await testDb.insert(schema.preventionRiskProgramActions).values({
    id: ACTION, programId: PROGRAM, actionNumber: 1, description: "Inspección de extintores", scheduleKind: "monthly",
    startsOn: "2026-01-01", responsibleUserId: "u-nominal", responsibleSnapshot: "Supervisor nominal", createdByUserId: "u-exec",
  })
  await testDb.insert(schema.preventionRiskProgramOccurrences).values([
    { id: "occ-past", actionId: ACTION, dueOn: "2020-01-31", outcome: "pending" },
    { id: "occ-overdue", actionId: ACTION, dueOn: "2020-06-30", outcome: "pending" },
    { id: "occ-future", actionId: ACTION, dueOn: "2999-12-31", outcome: "pending" },
    { id: "occ-super", actionId: ACTION, dueOn: "2026-05-31", outcome: "superseded" },
  ])
  /* Evidencia ya subida por el formulario (dominio `miper`, prueba de la 0347). */
  await testDb.insert(schema.preventionEvidenceUploads).values({
    path: EVIDENCE_PATH, domain: "miper", uploadedByUserId: "u-exec", worksiteId: WS,
    sha256: "a".repeat(64), sizeBytes: 1024, mimeType: "application/pdf",
    createdAt: new Date().toISOString(), claimedAt: new Date().toISOString(),
  })
}, 60_000)

describe("ejecución del programa", () => {
  it("«Se hizo» exige evidencia y fecha no futura; «No se hizo» exige motivo", async () => {
    await expect(execution.recordOccurrence({ occurrenceId: "occ-past", outcome: "done", effectiveOn: "2020-01-31" }, execAccess))
      .rejects.toThrow(/evidencia de la ejecución/)
    await expect(execution.recordOccurrence({ occurrenceId: "occ-future", outcome: "done", effectiveOn: "2999-12-31", evidence: [{ evidenceUploadId: EVIDENCE_PATH }] }, execAccess))
      .rejects.toThrow(/no puede ser futura/)
    await expect(execution.recordOccurrence({ occurrenceId: "occ-past", outcome: "not_done", reason: "corto" }, execAccess))
      .rejects.toThrow(/al menos 10 caracteres/)
    expect(await recordsOf("occ-past")).toHaveLength(0)
  })

  it("una Incumplida se registra después como «Se hizo fuera de plazo»: dos registros y el vigente manda", async () => {
    const notDone = await execution.recordOccurrence({ occurrenceId: "occ-past", outcome: "not_done", reason: "No se alcanzó a ejecutar en la fecha comprometida." }, execAccess)
    notDoneRecordId = notDone.recordId
    const done = await execution.recordOccurrence({
      occurrenceId: "occ-past", outcome: "done", effectiveOn: "2020-02-15",
      evidence: [{ evidenceUploadId: EVIDENCE_PATH, description: "Acta de inspección firmada" }],
    }, execAccess)
    expect(done.late).toBe(true)

    const records = await recordsOf("occ-past")
    expect(records).toHaveLength(2)
    const occurrence = await occurrenceOf("occ-past")
    expect(occurrence).toMatchObject({ outcome: "done", currentRecordId: done.recordId })
    // El archivo se acredita al registro, sin borrarse.
    const evidence = await testDb.select().from(schema.preventionRiskOccurrenceEvidence)
      .where(eq(schema.preventionRiskOccurrenceEvidence.recordId, done.recordId))
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({ evidenceUploadId: EVIDENCE_PATH, uploadedByUserId: "u-exec" })
  })

  it("el avance excluye las superseded y cuenta las vencidas aparte", async () => {
    const workspace = await getProgramWorkspace(MATRIX, execAccess)
    expect(workspace.progress).toMatchObject({ done: 1, late: 1, pending: 2, overdue: 1, failed: 0, planned: 3 })
    expect(workspace.progress.ratio).toBeCloseTo(1 / 3)
    expect(workspace.actions.map((action) => ({ actionId: action.id, progress: action.progress }))).toEqual([{ actionId: ACTION, progress: workspace.progress }])
  })

  it("anular el registro vigente devuelve la ocurrencia al anterior y luego a Pendiente", async () => {
    const done = (await recordsOf("occ-past")).find((row) => row.outcome === "done")!
    await execution.voidOccurrenceRecord({ recordId: done.id, reason: "La fecha efectiva estaba equivocada." }, execAccess)
    expect(await occurrenceOf("occ-past")).toMatchObject({ outcome: "not_done", currentRecordId: notDoneRecordId })
    await expect(execution.voidOccurrenceRecord({ recordId: done.id, reason: "Otra vez el mismo registro." }, execAccess))
      .rejects.toThrow(/ya está anulado/)

    await execution.voidOccurrenceRecord({ recordId: notDoneRecordId, reason: "Tampoco corresponde este registro." }, execAccess)
    expect(await occurrenceOf("occ-past")).toMatchObject({ outcome: "pending", currentRecordId: null })
    // Nada se borró: los dos registros siguen visibles con su motivo de anulación.
    const records = await recordsOf("occ-past")
    expect(records).toHaveLength(2)
    expect(records.every((row) => row.voidedAt !== null && row.voidReason !== null)).toBe(true)
  })

  it("un tercero sin permiso no registra y el responsable nominal sí (con risk:view)", async () => {
    await expect(execution.recordOccurrence({ occurrenceId: "occ-future", outcome: "not_done", reason: "Intento de un tercero cualquiera." }, otherAccess))
      .rejects.toThrow(/fuera de alcance/)
    const nominal = await execution.recordOccurrence({ occurrenceId: "occ-overdue", outcome: "not_done", reason: "No hubo acceso a la zona por el temporal." }, nominalAccess)
    nominalRecordId = nominal.recordId
    expect(nominal.outcome).toBe("not_done")
    expect(await occurrenceOf("occ-overdue")).toMatchObject({ outcome: "not_done", currentRecordId: nominal.recordId })
  })

  it("la base rechaza corregir el contenido de un registro", async () => {
    /* Drizzle envuelve el error del trigger: el mensaje original viaja en `cause`. */
    const rejection = async (run: Promise<unknown>) => String((await run.then(() => null, (error: unknown) => error) as { cause?: { message?: string } } | null)?.cause?.message ?? "")
    const update = await rejection(testDb.update(schema.preventionRiskProgramOccurrenceRecords).set({ notes: "Corrección a mano" })
      .where(eq(schema.preventionRiskProgramOccurrenceRecords.id, nominalRecordId)))
    expect(update).toMatch(/sólo inserción/)
    const remove = await rejection(testDb.delete(schema.preventionRiskProgramOccurrenceRecords)
      .where(eq(schema.preventionRiskProgramOccurrenceRecords.id, nominalRecordId)))
    expect(remove).toMatch(/no se borran/)
    // El registro quedó intacto.
    const [record] = await recordsOf("occ-overdue")
    expect(record!.notes).toBeNull()
  })

  it("la evidencia exige el dominio miper, se retira con motivo y el archivo no se borra", async () => {
    await expect(testDb.insert(schema.preventionEvidenceUploads).values({
      path: "storage/otro/inventado.pdf", domain: "otro", sha256: "b".repeat(64), sizeBytes: 10, mimeType: "application/pdf", createdAt: new Date().toISOString(),
    })).rejects.toThrow()

    const added = await execution.addOccurrenceEvidence({ recordId: nominalRecordId, evidenceUploadId: EVIDENCE_PATH, description: "Correo del temporal" }, nominalAccess)
    await expect(execution.withdrawOccurrenceEvidence({ evidenceId: added.id, reason: "corto" }, nominalAccess)).rejects.toThrow(/al menos 10 caracteres/)
    await execution.withdrawOccurrenceEvidence({ evidenceId: added.id, reason: "La foto no corresponde a esta actividad." }, nominalAccess)

    const [evidence] = await testDb.select().from(schema.preventionRiskOccurrenceEvidence)
      .where(eq(schema.preventionRiskOccurrenceEvidence.id, added.id))
    expect(evidence!.withdrawnAt).not.toBeNull()
    expect(evidence!.withdrawnByUserId).toBe("u-nominal")
    expect(evidence!.withdrawReason).toBe("La foto no corresponde a esta actividad.")
    // El archivo sigue en su lugar.
    const [upload] = await testDb.select().from(schema.preventionEvidenceUploads)
      .where(eq(schema.preventionEvidenceUploads.path, EVIDENCE_PATH))
    expect(upload).toBeDefined()
  })

  it("no se registra sobre una ocurrencia reemplazada", async () => {
    await expect(execution.recordOccurrence({ occurrenceId: "occ-super", outcome: "not_done", reason: "Intento sobre lo reemplazado." }, execAccess))
      .rejects.toThrow(/reemplazada por el período siguiente/)
  })
})

describe("descarga de la evidencia del programa", () => {
  const WS2 = "ws-exec-otra"
  const inScope = { mode: "some" as const, ids: [WS] }
  const upload = (path: string, mimeType: string, worksiteId: string | null = WS) => ({
    path, domain: "miper", worksiteId, sha256: "c".repeat(64), sizeBytes: 10, mimeType,
    createdAt: new Date().toISOString(), claimedAt: worksiteId ? new Date().toISOString() : null,
  })

  beforeAll(async () => {
    await testDb.insert(schema.worksites).values({ id: WS2, name: "Otra faena", code: "EXEC2" })
    await testDb.insert(schema.preventionRiskMatrices).values({
      id: "mx-exec-otra", worksiteId: WS2, matrixVersion: 1, title: "MIPER otra faena 2026", period: 2026, status: "published",
      reviewedByUserId: "u-exec", approvedByUserId: "u-exec", publishedByUserId: "u-exec", publishedAt: new Date().toISOString(),
      methodologyId: "m-exec", methodologySnapshot: {}, revisionReason: "Elaboración inicial.", participationSummary: "", consultationEvidenceReference: "", createdByUserId: "u-exec",
    })
    await testDb.insert(schema.preventionRiskPrograms).values({ id: "prog-exec-otra", matrixId: "mx-exec-otra", worksiteId: WS2, period: 2026, createdByUserId: "u-exec" })
    await testDb.insert(schema.preventionRiskProgramActions).values({
      id: "act-exec-otra", programId: "prog-exec-otra", actionNumber: 1, description: "Actividad de otra faena", scheduleKind: "once", startsOn: "2026-01-01", createdByUserId: "u-exec",
    })
    await testDb.insert(schema.preventionRiskProgramOccurrences).values({ id: "occ-otra", actionId: "act-exec-otra", dueOn: "2026-01-31", outcome: "pending" })

    await testDb.insert(schema.preventionEvidenceUploads).values([
      upload("storage/miper-evidence/dl-ok.pdf", "application/pdf"),
      upload("storage/miper-evidence/dl-retirada.pdf", "application/pdf"),
      upload("storage/miper-evidence/dl-anulada.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      upload("storage/miper-evidence/dl-huerfana.pdf", "application/pdf"),
      upload("storage/miper-evidence/dl-otra.pdf", "application/pdf", WS2),
    ])
    await testDb.insert(schema.preventionRiskProgramOccurrenceRecords).values([
      { id: "rec-dl-vivo", occurrenceId: "occ-future", outcome: "done", effectiveOn: "2020-01-31", recordedByUserId: "u-exec" },
      {
        id: "rec-dl-anulado", occurrenceId: "occ-future", outcome: "done", effectiveOn: "2020-01-30", recordedByUserId: "u-exec",
        voidedAt: new Date().toISOString(), voidedByUserId: "u-exec", voidReason: "Se registró por error esta fecha.",
      },
      { id: "rec-dl-otra", occurrenceId: "occ-otra", outcome: "done", effectiveOn: "2026-01-30", recordedByUserId: "u-exec" },
    ])
    await testDb.insert(schema.preventionRiskOccurrenceEvidence).values([
      { id: "ev-dl-ok", recordId: "rec-dl-vivo", evidenceUploadId: "storage/miper-evidence/dl-ok.pdf", uploadedByUserId: "u-exec" },
      {
        id: "ev-dl-retirada", recordId: "rec-dl-vivo", evidenceUploadId: "storage/miper-evidence/dl-retirada.pdf", uploadedByUserId: "u-exec",
        withdrawnAt: new Date().toISOString(), withdrawnByUserId: "u-exec", withdrawReason: "Archivo equivocado, se sube otro.",
      },
      { id: "ev-dl-anulada", recordId: "rec-dl-anulado", evidenceUploadId: "storage/miper-evidence/dl-anulada.docx", uploadedByUserId: "u-exec" },
      { id: "ev-dl-otra", recordId: "rec-dl-otra", evidenceUploadId: "storage/miper-evidence/dl-otra.pdf", uploadedByUserId: "u-exec" },
    ])
  }, 60_000)

  it("findMiperEvidenceForDownload: en alcance devuelve el MIME de la subida", async () => {
    await expect(evidenceAccess.findMiperEvidenceForDownload(testDb, "storage/miper-evidence/dl-ok.pdf", inScope)).resolves.toEqual({
      storedPath: "storage/miper-evidence/dl-ok.pdf", mimeType: "application/pdf", withdrawnAt: null, recordVoidedAt: null,
    })
    // El alcance global también la ve.
    await expect(evidenceAccess.findMiperEvidenceForDownload(testDb, "storage/miper-evidence/dl-ok.pdf", { mode: "all", ids: [] })).resolves.toMatchObject({ mimeType: "application/pdf" })
  })

  it("findMiperEvidenceForDownload: de otra faena → null", async () => {
    await expect(evidenceAccess.findMiperEvidenceForDownload(testDb, "storage/miper-evidence/dl-otra.pdf", inScope)).resolves.toBeNull()
    await expect(evidenceAccess.findMiperEvidenceForDownload(testDb, "storage/miper-evidence/dl-otra.pdf", { mode: "some", ids: [WS2] })).resolves.toMatchObject({ mimeType: "application/pdf" })
  })

  it("findMiperEvidenceForDownload: una subida sin fila de evidencia → null", async () => {
    await expect(evidenceAccess.findMiperEvidenceForDownload(testDb, "storage/miper-evidence/dl-huerfana.pdf", { mode: "all", ids: [] })).resolves.toBeNull()
    await expect(evidenceAccess.findMiperEvidenceForDownload(testDb, "storage/miper-evidence/no-existe.pdf", { mode: "all", ids: [] })).resolves.toBeNull()
  })

  it("findMiperEvidenceForDownload: retirada y de registro anulado se sirven (withdrawnAt / recordVoidedAt)", async () => {
    const withdrawn = await evidenceAccess.findMiperEvidenceForDownload(testDb, "storage/miper-evidence/dl-retirada.pdf", inScope)
    expect(withdrawn).toMatchObject({ mimeType: "application/pdf", recordVoidedAt: null })
    expect(withdrawn!.withdrawnAt).not.toBeNull()
    const voided = await evidenceAccess.findMiperEvidenceForDownload(testDb, "storage/miper-evidence/dl-anulada.docx", inScope)
    expect(voided).toMatchObject({ withdrawnAt: null })
    expect(voided!.recordVoidedAt).not.toBeNull()
  })

  it("findMiperEvidenceForDownload: alcance none → null", async () => {
    await expect(evidenceAccess.findMiperEvidenceForDownload(testDb, "storage/miper-evidence/dl-ok.pdf", { mode: "none", ids: [] })).resolves.toBeNull()
  })
})

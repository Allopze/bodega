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
    const progress = await execution.getProgramProgress(testDb, MATRIX)
    expect(progress.program).toMatchObject({ done: 1, late: 1, pending: 2, overdue: 1, failed: 0, planned: 3 })
    expect(progress.program.ratio).toBeCloseTo(1 / 3)
    expect(progress.byAction).toEqual([{ actionId: ACTION, progress: progress.program }])
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

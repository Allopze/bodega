import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const { saveMiperEntry } = await import("@/lib/services/miper/entries")
const q = await import("@/lib/services/miper/queries")
const pq = await import("@/lib/services/miper/program-queries")

const author = { userId: "u-p", scope: { mode: "some" as const, ids: ["ws-p"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const outsider = { userId: "u-o", scope: { mode: "some" as const, ids: ["ws-other"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }

let matrixId = ""
let emptyMatrixId = ""
let detailMatrixId = ""
let firstEntryRowNumber = 0

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([
    { id: "ws-p", name: "Faena Programa", code: "P" },
    { id: "ws-other", name: "Otra", code: "O" },
  ])
  await testDb.insert(schema.users).values([
    { id: "u-p", name: "Prevencionista P", email: "p@p.cl", hashedPassword: "x", isActive: true },
    { id: "u-r", name: "Responsable R", email: "r@p.cl", hashedPassword: "x", isActive: true },
    { id: "u-o", name: "Ajeno", email: "o@p.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksiteUsers).values({ userId: "u-p", worksiteId: "ws-p" })

  matrixId = (await createMiper({ worksiteId: "ws-p", period: 2026, revisionReason: "Período con programa." }, author)).id
  await saveMiperEntry({ matrixId, values: { hazard: "Ruido", probability: 1, consequence: 2 } }, author)
  await saveMiperEntry({ matrixId, values: { hazard: "Volcamiento", probability: 4, consequence: 4 } }, author)
  emptyMatrixId = (await createMiper({ worksiteId: "ws-p", period: 2027, revisionReason: "Período sin programa." }, author)).id

  // Medidas de control vinculables: se insertan directo para no depender de los
  // servicios de escritura del programa (que son de otra tarea y aún no existen).
  const entries = await testDb.select({ id: schema.preventionRiskEntries.id, rowNumber: schema.preventionRiskEntries.rowNumber })
    .from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, matrixId)).orderBy(schema.preventionRiskEntries.rowNumber)
  firstEntryRowNumber = entries[0]!.rowNumber ?? 0
  await testDb.insert(schema.preventionRiskControls).values([
    { id: "c-1", riskEntryId: entries[0]!.id, description: "Instalar baranda perimetral", hierarchy: "engineering" },
    { id: "c-2", riskEntryId: entries[1]!.id, description: "Capacitar en izaje", hierarchy: "administrative" },
  ])

  // Versión sellada: de ella sale la «Fecha última revisión» del encabezado.
  await testDb.insert(schema.preventionRiskReviewRounds).values({
    id: "round-1", matrixId, roundNumber: 1, stage: "technical", snapshot: { header: {}, entries: [] },
    snapshotSha256: "a".repeat(64), submittedByUserId: "u-p", decision: "approved", decidedByUserId: "u-p",
  })
  await testDb.insert(schema.preventionRiskMatrixVersions).values({
    id: "v-1", matrixId, versionNumber: 1, roundId: "round-1", snapshot: { header: {}, entries: [] }, snapshotSha256: "b".repeat(64),
    changeSummary: "Versión inicial.", elaboratedByUserId: "u-p", technicalReviewerUserId: "u-p", approverUserId: "u-p",
    elaboratedByName: "Prevencionista P", technicalReviewerName: "Prevencionista P", approverName: "Prevencionista P",
    approvedAt: "2026-02-15T10:00:00.000Z",
  })

  await testDb.insert(schema.preventionRiskPrograms).values({
    id: "prog-1", matrixId, worksiteId: "ws-p", period: 2026,
    companyName: "CHOME", programManagerUserId: "u-p", elaboratedOn: "2026-01-10", createdByUserId: "u-p",
  })
  await testDb.insert(schema.preventionRiskProcesses).values([
    { id: "proc-b", worksiteId: "ws-p", code: "B", name: "Despacho", normalizedName: "despacho" },
    { id: "proc-a", worksiteId: "ws-p", code: "A", name: "Acopio", normalizedName: "acopio" },
    { id: "proc-x", worksiteId: "ws-p", code: "X", name: "Proceso cerrado", normalizedName: "proceso cerrado", isActive: false },
    { id: "proc-o", worksiteId: "ws-other", code: "O", name: "De otra faena", normalizedName: "de otra faena" },
  ])
  await testDb.insert(schema.preventionRiskProgramActions).values([
    {
      id: "act-1", programId: "prog-1", processId: "proc-b", actionNumber: 1, description: "Ejecutar el control de ruido", responsibleUserId: "u-r",
      responsibleSnapshot: "Responsable R — Encargado", locationLabel: "Faena Programa", scheduleKind: "monthly", startsOn: "2026-01-01", createdByUserId: "u-p",
    },
    {
      id: "act-2", programId: "prog-1", actionNumber: 2, description: "Actividad retirada", scheduleKind: "once", startsOn: "2026-03-01",
      status: "retired", retiredAt: "2026-03-05T00:00:00.000Z", retiredReason: "Reemplazada por otra actividad.", createdByUserId: "u-p",
    },
  ])
  // La segunda se inserta primero para que el orden final (por fila) sea el de la fila 1.
  await testDb.insert(schema.preventionRiskProgramActionControls).values([
    { id: "l-2", actionId: "act-1", controlId: "c-2", linkedByUserId: "u-p" },
    { id: "l-1", actionId: "act-1", controlId: "c-1", linkedByUserId: "u-p" },
  ])

  // Ocurrencias: se insertan desordenadas a propósito para probar el orden por fecha.
  await testDb.insert(schema.preventionRiskProgramOccurrences).values([
    { id: "o-e", actionId: "act-1", dueOn: "2000-03-31", outcome: "pending" },
    { id: "o-c", actionId: "act-1", dueOn: "2999-12-31", outcome: "pending" },
    { id: "o-a", actionId: "act-1", dueOn: "2000-01-31", outcome: "pending" },
    { id: "o-d", actionId: "act-1", dueOn: "2000-04-30", outcome: "superseded" },
    { id: "o-b", actionId: "act-1", dueOn: "2000-02-28", outcome: "pending" },
  ])
  await testDb.insert(schema.preventionRiskProgramOccurrenceRecords).values([
    { id: "rec-a", occurrenceId: "o-a", outcome: "done", effectiveOn: "2000-02-05", late: true, recordedByUserId: "u-r" },
    { id: "rec-e", occurrenceId: "o-e", outcome: "not_done", reason: "No se ejecutó por lluvia", recordedByUserId: "u-r" },
  ])
  await testDb.update(schema.preventionRiskProgramOccurrences).set({ outcome: "done", currentRecordId: "rec-a" }).where(eq(schema.preventionRiskProgramOccurrences.id, "o-a"))
  await testDb.update(schema.preventionRiskProgramOccurrences).set({ outcome: "not_done", currentRecordId: "rec-e" }).where(eq(schema.preventionRiskProgramOccurrences.id, "o-e"))

  // Evidencia: una vigente y una retirada sobre el mismo registro. El dominio
  // del archivo es indiferente a esta consulta —sólo importa la fila de vínculo—
  // así que se usa uno ya permitido por el CHECK de `prevention_evidence_uploads`.
  await testDb.insert(schema.preventionEvidenceUploads).values({
    path: "storage/miper-evidence/tope.pdf", domain: "capa", sha256: "d".repeat(64), sizeBytes: 100, mimeType: "application/pdf",
    createdAt: "2026-01-01T00:00:00.000Z",
  })
  await testDb.insert(schema.preventionRiskOccurrenceEvidence).values([
    { id: "ev-1", recordId: "rec-a", evidenceUploadId: "storage/miper-evidence/tope.pdf", uploadedByUserId: "u-r" },
    {
      id: "ev-2", recordId: "rec-a", evidenceUploadId: "storage/miper-evidence/tope.pdf", uploadedByUserId: "u-r",
      withdrawnAt: "2026-01-05T00:00:00.000Z", withdrawnByUserId: "u-r", withdrawReason: "Archivo equivocado",
    },
  ])

  // Una MIPER aparte para el detalle de una actividad: 3 ocurrencias, una con un
  // registro anulado (y su reemplazo) y evidencia retirada, y un Word sin vista previa.
  detailMatrixId = (await createMiper({ worksiteId: "ws-p", period: 2028, revisionReason: "Período para el detalle de actividad." }, author)).id
  await testDb.insert(schema.preventionRiskPrograms).values({ id: "prog-d", matrixId: detailMatrixId, worksiteId: "ws-p", period: 2028, createdByUserId: "u-p" })
  await testDb.insert(schema.preventionRiskProgramActions).values({
    id: "act-d", programId: "prog-d", actionNumber: 1, description: "Revisión de extintores", scheduleKind: "monthly", startsOn: "2028-01-01", createdByUserId: "u-p",
  })
  await testDb.insert(schema.preventionRiskProgramOccurrences).values([
    { id: "od-3", actionId: "act-d", dueOn: "2028-03-31", outcome: "pending" },
    { id: "od-1", actionId: "act-d", dueOn: "2028-01-31", outcome: "pending" },
    { id: "od-2", actionId: "act-d", dueOn: "2028-02-29", outcome: "pending" },
  ])
  await testDb.insert(schema.preventionRiskProgramOccurrenceRecords).values([
    {
      id: "rec-d1", occurrenceId: "od-1", outcome: "done", effectiveOn: "2028-01-30", recordedByUserId: "u-r", recordedAt: "2028-02-01T10:00:00.000Z",
      voidedAt: "2028-02-02T10:00:00.000Z", voidedByUserId: "u-p", voidReason: "La fecha efectiva estaba equivocada.",
    },
    { id: "rec-d2", occurrenceId: "od-1", outcome: "done", effectiveOn: "2028-01-29", late: false, recordedByUserId: "u-r", recordedAt: "2028-02-03T10:00:00.000Z" },
    { id: "rec-d3", occurrenceId: "od-3", outcome: "not_done", reason: "No se pudo por falta de acceso.", recordedByUserId: "u-r", recordedAt: "2028-04-02T10:00:00.000Z" },
  ])
  await testDb.update(schema.preventionRiskProgramOccurrences).set({ outcome: "done", currentRecordId: "rec-d2" }).where(eq(schema.preventionRiskProgramOccurrences.id, "od-1"))
  await testDb.insert(schema.preventionEvidenceUploads).values([
    { path: "storage/miper-evidence/acta-d.pdf", domain: "miper", sha256: "e".repeat(64), sizeBytes: 100, mimeType: "application/pdf", createdAt: "2028-02-01T00:00:00.000Z" },
    { path: "storage/miper-evidence/registro-d.docx", domain: "miper", sha256: "f".repeat(64), sizeBytes: 100, createdAt: "2028-02-03T00:00:00.000Z",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ])
  await testDb.insert(schema.preventionRiskOccurrenceEvidence).values([
    {
      id: "ev-d1", recordId: "rec-d1", evidenceUploadId: "storage/miper-evidence/acta-d.pdf", uploadedByUserId: "u-r", uploadedAt: "2028-02-01T10:05:00.000Z",
      withdrawnAt: "2028-02-02T09:00:00.000Z", withdrawnByUserId: "u-p", withdrawReason: "Archivo equivocado, se sube otro.",
    },
    { id: "ev-d2", recordId: "rec-d2", evidenceUploadId: "storage/miper-evidence/registro-d.docx", description: "Registro firmado", uploadedByUserId: "u-r", uploadedAt: "2028-02-03T10:05:00.000Z" },
  ])
}, 60_000)

describe("consulta del Programa de Trabajo", () => {
  it("trae el encabezado, las actividades con sus controles, las ocurrencias y el avance derivado", async () => {
    const ws = await pq.getProgramWorkspace(matrixId, author)

    expect(ws.program?.id).toBe("prog-1")
    expect(ws.program?.programManagerName).toBe("Prevencionista P")
    // La fecha sale de la versión sellada (Postgres la devuelve con su zona).
    expect(ws.program?.lastReviewedOn).toMatch(/^2026-02-15/)
    const activeWorksites = (await testDb.select({ count: sql<number>`count(*)::int` }).from(schema.worksites).where(eq(schema.worksites.isActive, true)))[0]?.count ?? 0
    expect(ws.program?.worksiteCount).toBe(activeWorksites)

    // Actividades por número correlativo; la retirada conserva su motivo.
    expect(ws.actions.map((a) => [a.actionNumber, a.status])).toEqual([[1, "active"], [2, "retired"]])
    const action = ws.actions[0]!
    expect(action).toMatchObject({
      processId: "proc-b", processName: "Despacho", description: "Ejecutar el control de ruido", responsibleUserId: "u-r",
      responsibleName: "Responsable R — Encargado", locationLabel: "Faena Programa", scheduleKind: "monthly", startsOn: "2026-01-01",
    })
    expect(ws.actions[1]!.retiredReason).toBe("Reemplazada por otra actividad.")

    // Controles vinculados, en el orden de la fila del MIPER.
    expect(action.controls.map((c) => [c.id, c.rowNumber])).toEqual([["c-1", firstEntryRowNumber], ["c-2", firstEntryRowNumber + 1]])

    // Ocurrencias ordenadas por fecha, con el resultado vigente de cada una.
    expect(action.occurrences.map((o) => o.dueOn)).toEqual(["2000-01-31", "2000-02-28", "2000-03-31", "2000-04-30", "2999-12-31"])
    const done = action.occurrences.find((o) => o.id === "o-a")!
    expect(done).toMatchObject({ outcome: "done", late: true, effectiveOn: "2000-02-05", reason: null, evidenceCount: 1 })
    const notDone = action.occurrences.find((o) => o.id === "o-e")!
    expect(notDone).toMatchObject({ outcome: "not_done", late: false, effectiveOn: null, reason: "No se ejecutó por lluvia", evidenceCount: 0 })
    const pending = action.occurrences.find((o) => o.id === "o-b")!
    expect(pending).toMatchObject({ outcome: "pending", effectiveOn: null, evidenceCount: 0 })
    expect(action.occurrences.find((o) => o.id === "o-d")!.outcome).toBe("superseded")

    // Avance por actividad y total, derivados: `superseded` fuera de `planned`.
    expect(action.progress).toEqual({ done: 1, late: 1, pending: 2, overdue: 1, failed: 1, planned: 4, ratio: 0.25 })
    expect(ws.progress).toEqual({ done: 1, late: 1, pending: 2, overdue: 1, failed: 1, planned: 4, ratio: 0.25 })
    expect(ws.proposals).toBeNull()
  })

  it("una MIPER sin programa devuelve `program: null` y nada más", async () => {
    const ws = await pq.getProgramWorkspace(emptyMatrixId, author)
    expect(ws.program).toBeNull()
    expect(ws.actions).toEqual([])
    expect(ws.progress).toMatchObject({ planned: 0, ratio: null })
  })

  it("el espacio de trabajo trae el encabezado del programa", async () => {
    const workspace = await q.getMiperWorkspace(matrixId, author)
    expect(workspace.program?.id).toBe("prog-1")
    expect(workspace.program?.lastReviewedOn).toMatch(/^2026-02-15/)
    // Una MIPER sin programa lo declara nulo, no lo inventa.
    expect((await q.getMiperWorkspace(emptyMatrixId, author)).program).toBeNull()
  })

  it("getProgramWorkspace trae processes y processId", async () => {
    const ws = await pq.getProgramWorkspace(matrixId, author)
    // Sólo los procesos activos de la faena de la MIPER, por nombre.
    expect(ws.processes).toEqual([{ id: "proc-a", name: "Acopio" }, { id: "proc-b", name: "Despacho" }])
    expect(ws.actions[0]!.processId).toBe("proc-b")
    expect(ws.actions[1]!.processId).toBeNull()
    // Sin programa también se devuelven.
    expect((await pq.getProgramWorkspace(emptyMatrixId, author)).processes).toEqual(ws.processes)
  })

  it("getProgramActionDetail trae todas las ocurrencias con sus registros y evidencia en una lectura", async () => {
    const detail = await pq.getProgramActionDetail("act-d", author)
    expect(detail.actionId).toBe("act-d")
    expect(detail.occurrences.map((o) => o.occurrenceId)).toEqual(["od-1", "od-2", "od-3"])

    const [first, second, third] = detail.occurrences
    expect(first!.currentRecordId).toBe("rec-d2")
    // Más reciente primero; el anulado se devuelve marcado, con quién y por qué.
    expect(first!.records.map((r) => r.id)).toEqual(["rec-d2", "rec-d1"])
    const [replacement, voided] = first!.records
    expect(replacement).toMatchObject({ outcome: "done", effectiveOn: "2028-01-29", voidedAt: null, recordedByName: "Responsable R" })
    expect(voided).toMatchObject({ voidedByName: "Prevencionista P", voidReason: "La fecha efectiva estaba equivocada." })
    expect(voided!.voidedAt).not.toBeNull()

    // La evidencia retirada se devuelve marcada; el PDF se abre inline, el Word no.
    expect(voided!.evidence).toHaveLength(1)
    expect(voided!.evidence[0]).toMatchObject({
      id: "ev-d1", fileName: "acta-d.pdf", mimeType: "application/pdf", inlineSafe: true,
      withdrawReason: "Archivo equivocado, se sube otro.", uploadedByName: "Responsable R",
    })
    expect(voided!.evidence[0]!.withdrawnAt).not.toBeNull()
    expect(replacement!.evidence[0]).toMatchObject({ fileName: "registro-d.docx", description: "Registro firmado", inlineSafe: false, withdrawnAt: null })

    expect(second).toMatchObject({ currentRecordId: null, records: [] })
    expect(third!.records).toMatchObject([{ id: "rec-d3", outcome: "not_done", reason: "No se pudo por falta de acceso.", evidence: [] }])
  })

  it("getProgramActionDetail: fuera de alcance y actividad inexistente dan el mismo error", async () => {
    const outOfScope = await pq.getProgramActionDetail("act-d", outsider).catch((error: unknown) => error as Error)
    const missing = await pq.getProgramActionDetail("act-no-existe", author).catch((error: unknown) => error as Error)
    expect(outOfScope).toBeInstanceOf(Error)
    expect(missing).toBeInstanceOf(Error)
    expect((outOfScope as Error).message).toBe((missing as Error).message)
  })

  it("getProgramActionDetail: sin prevention:risk:view, rechaza", async () => {
    await expect(pq.getProgramActionDetail("act-d", { ...author, permissions: ["prevention:risk:edit"] })).rejects.toThrow()
  })

  it("fuera de alcance no se lee", async () => {
    await expect(pq.getProgramWorkspace(matrixId, outsider)).rejects.toThrow(/fuera de alcance/)
  })
})

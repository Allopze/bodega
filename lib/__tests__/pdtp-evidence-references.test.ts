/**
 * lib/__tests__/pdtp-evidence-references.test.ts
 *
 * Tanda T4 (qa/reports/2026-09-26-prevencion-production-readiness.md):
 *
 * - PREV-M02-A: la descarga busca al dueño del archivo por igualdad exacta
 *   (`findPdtpEvidenceOwner`), no con `LIKE %name%`.
 * - PREV-I05: la descarga PDTP también autoriza la evidencia del plan de acción
 *   (CAPA del PDTP) y la de las instancias programadas, que viven en el mismo
 *   directorio pero no en `pdtp_executions`.
 * - PREV-I13-C: `collectPdtpEvidenceReferences` es la fuente única de
 *   referencias (ejecuciones, CAPA, historial e instancias) para el escaneo de
 *   integridad y para el GC.
 */
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path, { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { findPdtpEvidenceOwner, collectPdtpEvidenceReferences } = await import("@/lib/services/pdtp/evidence-references")
const { scanPdtpEvidenceIntegrity } = await import("@/lib/services/pdtp/evidence-integrity")
const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
const { recordPdtpEvidenceUpload } = await import("@/lib/services/pdtp/evidence-uploads")

const WS = "ws-refs"
const WS_OTHER = "ws-refs-other"
const USER = "user-refs"
const PROGRAM = "prog-refs"
const ACT = "act-refs"
const now = new Date().toISOString()

let tempDir: string
let originalStoragePath: string | undefined

function evidencePath(name: string) {
  return `storage/pdtp-evidence/${name}`
}

function writeEvidence(name: string, content = `DATA ${name}`, ageMs = 0) {
  const file = join(tempDir, "pdtp-evidence", name)
  writeFileSync(file, content)
  if (ageMs > 0) {
    const old = new Date(Date.now() - ageMs)
    utimesSync(file, old, old)
  }
  return evidencePath(name)
}

async function insertExecution(id: string, worksiteId: string, fields: Partial<typeof schema.pdtpExecutions.$inferInsert> = {}) {
  await inMemoryDb.insert(schema.pdtpExecutions).values({
    id, activityId: ACT, worksiteId, year: 2026, month: 1, week: Number(id.slice(-1)) % 4 + 1,
    executedQuantity: 1, status: "submitted", evidencePhotos: [], createdAt: now, updatedAt: now,
    ...fields,
  })
}

async function insertCapaEvidence(reference: string, sourceType = "pdtp", worksiteId = WS, suffix = "1") {
  await inMemoryDb.insert(schema.preventionCapaActions).values({
    id: `capa-${suffix}`, code: `CAPA-2026-000${suffix}`, sourceType, sourceId: "exec-1",
    worksiteId, finding: "Hallazgo", actionDescription: "Acción",
    targetDate: "2026-09-01", createdByUserId: USER, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.preventionCapaEvidence).values({
    id: `capaev-${suffix}`, actionId: `capa-${suffix}`, kind: "photo", reference,
    uploadedByUserId: USER, createdAt: now,
  })
}

async function insertInstance(evidenceRef: string, worksiteId = WS) {
  await inMemoryDb.insert(schema.pdtpScheduledInstances).values({
    id: "inst-1", programId: PROGRAM, activityId: ACT, worksiteId, scheduledFor: "2026-03-02",
    isoWeekYear: 2026, isoWeek: 10, status: "completed", idempotencyKey: "inst-key-1",
    sourceMetadataJson: { evidenceRef }, createdAt: now, updatedAt: now,
  })
}

async function uploadRow(path: string) {
  const [row] = await inMemoryDb.select().from(schema.pdtpEvidenceUploads).where(eq(schema.pdtpEvidenceUploads.path, path))
  return row
}

function sha(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpEvidenceUploads)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.preventionCapaEvidence)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpScheduledInstances)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  tempDir = mkdtempSync(join(tmpdir(), "pdtp-evidence-refs-"))
  originalStoragePath = process.env.STORAGE_PATH
  process.env.STORAGE_PATH = tempDir
  const { promises: fs } = await import("node:fs")
  await fs.mkdir(join(tempDir, "pdtp-evidence"), { recursive: true })

  await inMemoryDb.insert(schema.users).values({ id: USER, name: "U", email: "u@refs", hashedPassword: "x", isActive: true })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS, name: "Faena refs", code: "FR", isActive: true },
    { id: WS_OTHER, name: "Otra faena", code: "OF", isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM, year: 2026, version: 1, status: "active", appliesToAllWorksites: true, title: "T",
    elaboratedByName: "X", elaboratedByTitle: "Y", createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACT, programId: PROGRAM, n: 1, activity: "A", program: "P", responsibleSlugs: [], responsibleDisplay: "R",
    sourceSheetRow: 1, createdAt: now, updatedAt: now,
  })
})

afterEach(() => {
  process.env.STORAGE_PATH = originalStoragePath
  rmSync(tempDir, { recursive: true, force: true })
})

describe("findPdtpEvidenceOwner — igualdad exacta (PREV-M02-A)", () => {
  it("encuentra el dueño por la ruta completa, en la principal o en las fotos", async () => {
    await insertExecution("exec-1", WS, { evidenceUrl: evidencePath("abcdef.pdf"), evidencePhotos: [evidencePath("foto-1.jpg")] })
    expect(await findPdtpEvidenceOwner("abcdef.pdf", "all")).toMatchObject({ worksiteId: WS, source: "execution" })
    expect(await findPdtpEvidenceOwner("foto-1.jpg", "all")).toMatchObject({ worksiteId: WS, source: "execution" })
  })

  it("un nombre que es parte de otro no se «adopta» (el LIKE %name% sí lo hacía)", async () => {
    await insertExecution("exec-1", WS, { evidenceUrl: evidencePath("abcdef.pdf"), evidencePhotos: [evidencePath("xfoto-1.jpg")] })
    expect(await findPdtpEvidenceOwner("bcdef.pdf", "all")).toBeNull()
    expect(await findPdtpEvidenceOwner("foto-1.jpg", "all")).toBeNull()
  })

  it("respeta el alcance de faenas", async () => {
    await insertExecution("exec-1", WS_OTHER, { evidenceUrl: evidencePath("ajena.pdf") })
    expect(await findPdtpEvidenceOwner("ajena.pdf", [WS])).toBeNull()
    expect(await findPdtpEvidenceOwner("ajena.pdf", [WS_OTHER])).toMatchObject({ worksiteId: WS_OTHER })
  })
})

describe("findPdtpEvidenceOwner — CAPA del PDTP e instancias (PREV-I05)", () => {
  it("autoriza la evidencia del plan de acción del PDTP", async () => {
    await insertCapaEvidence(evidencePath("capa.jpg"))
    expect(await findPdtpEvidenceOwner("capa.jpg", [WS])).toMatchObject({ worksiteId: WS, source: "capa" })
  })

  it("no autoriza la evidencia de una CAPA de otro origen por la ruta PDTP", async () => {
    await insertCapaEvidence(evidencePath("capa-inspeccion.jpg"), "inspection")
    expect(await findPdtpEvidenceOwner("capa-inspeccion.jpg", "all")).toBeNull()
  })

  it("autoriza la evidencia de una instancia programada", async () => {
    await insertInstance(evidencePath("instancia.pdf"))
    expect(await findPdtpEvidenceOwner("instancia.pdf", [WS])).toMatchObject({ worksiteId: WS, source: "instance" })
    expect(await findPdtpEvidenceOwner("instancia.pdf", [WS_OTHER])).toBeNull()
  })
})

describe("collectPdtpEvidenceReferences — fuente única (PREV-I13-C)", () => {
  it("reúne ejecuciones, CAPA, historial e instancias", async () => {
    await insertExecution("exec-1", WS, {
      evidenceUrl: evidencePath("exec.pdf"),
      sourceMetadataJson: { evidenceSha256: { [evidencePath("exec.pdf")]: "a".repeat(64) } },
    })
    await insertCapaEvidence(evidencePath("capa.jpg"))
    await insertInstance(evidencePath("inst.pdf"))
    await inMemoryDb.insert(schema.auditLog).values({
      id: "audit-1", action: "update", entityType: "pdtp:execution", entityId: "exec-1", worksiteId: WS,
      oldState: JSON.stringify({ status: "rejected", evidenceUrl: evidencePath("rechazada.pdf"), evidencePhotos: [] }),
      newState: JSON.stringify({ changeType: "resubmitted", evidenceUrl: evidencePath("exec.pdf"), evidencePhotos: [evidencePath("rechazada.pdf")] }),
    })

    const refs = await collectPdtpEvidenceReferences()
    const by = (source: string) => refs.filter((ref) => ref.source === source).map((ref) => ref.path).sort()
    expect(by("execution")).toEqual([evidencePath("exec.pdf")])
    expect(by("capa")).toEqual([evidencePath("capa.jpg")])
    expect(by("instance")).toEqual([evidencePath("inst.pdf")])
    expect(by("history")).toEqual([evidencePath("exec.pdf"), evidencePath("rechazada.pdf")])
    expect(refs.find((ref) => ref.source === "execution")?.sha256).toBe("a".repeat(64))
  })
})

describe("scanPdtpEvidenceIntegrity (PREV-I13-C)", () => {
  it("sin problemas cuando cada referencia tiene su archivo y su sha256 coincide", async () => {
    const content = "contenido íntegro"
    const url = writeEvidence("integro.pdf", content)
    await insertExecution("exec-1", WS, {
      evidenceUrl: url,
      sourceMetadataJson: { evidenceSha256: { [url]: createHash("sha256").update(content).digest("hex") } },
    })
    const result = await scanPdtpEvidenceIntegrity()
    expect(result).toMatchObject({ ok: true, checkedFiles: 1, missingCount: 0, checksumMismatchCount: 0 })
  })

  it("detecta una referencia cuyo archivo ya no está en disco, con su dueño", async () => {
    await insertExecution("exec-1", WS, { evidenceUrl: evidencePath("perdida.pdf") })
    await insertCapaEvidence(evidencePath("capa-perdida.jpg"))
    const result = await scanPdtpEvidenceIntegrity()
    expect(result.ok).toBe(false)
    expect(result.missingCount).toBe(2)
    expect(result.missing.map((item) => item.path).sort()).toEqual([evidencePath("capa-perdida.jpg"), evidencePath("perdida.pdf")])
    expect(result.missing.find((item) => item.path === evidencePath("perdida.pdf"))?.owners)
      .toEqual([{ source: "execution", ownerId: "exec-1", worksiteId: WS }])
  })

  it("detecta un archivo alterado: su sha256 ya no coincide con el guardado", async () => {
    const url = writeEvidence("alterado.pdf", "versión alterada")
    await insertExecution("exec-1", WS, {
      evidenceUrl: url,
      sourceMetadataJson: { evidenceSha256: { [url]: createHash("sha256").update("versión original").digest("hex") } },
    })
    const result = await scanPdtpEvidenceIntegrity()
    expect(result.ok).toBe(false)
    expect(result.checksumMismatchCount).toBe(1)
    expect(result.checksumMismatches[0]).toMatchObject({ path: url })
  })

  it("la evidencia de otro módulo no se busca en el directorio PDTP", async () => {
    await insertExecution("exec-1", WS, { origin: "integration", evidenceUrl: "storage/prevention-training-evidence/acta.pdf" })
    const result = await scanPdtpEvidenceIntegrity()
    expect(result).toMatchObject({ ok: true, checkedFiles: 0, missingCount: 0 })
  })
})

describe("cleanupPdtpEvidenceOrphans usa la misma fuente", () => {
  it("no borra un archivo que sólo referencia el historial o una instancia", async () => {
    const twoHours = 25 * 60 * 60 * 1000
    writeEvidence("solo-historial.pdf", "H", twoHours)
    writeEvidence("solo-instancia.pdf", "I", twoHours)
    writeEvidence("huerfano.pdf", "O", twoHours)
    await insertInstance(evidencePath("solo-instancia.pdf"))
    await inMemoryDb.insert(schema.auditLog).values({
      id: "audit-2", action: "update", entityType: "pdtp:execution", entityId: "exec-x", worksiteId: WS,
      newState: JSON.stringify({ changeType: "submitted", evidenceUrl: evidencePath("solo-historial.pdf"), evidencePhotos: [] }),
    })
    const result = await cleanupPdtpEvidenceOrphans({ olderThanMs: 60 * 60 * 1000 })
    expect(result.deletedNames).toEqual(["huerfano.pdf"])
    expect(existsSync(join(tempDir, "pdtp-evidence", "solo-historial.pdf"))).toBe(true)
    expect(existsSync(join(tempDir, "pdtp-evidence", "solo-instancia.pdf"))).toBe(true)
  })
})

/* PREV-M02-B (0334): registro de subidas. */
describe("registro de subidas (PREV-M02-B)", () => {
  it("guarda ruta, quien subió, faena, actividad, sha256, tamaño y tipo", async () => {
    const path = writeEvidence("subida.pdf", "PDF")
    await recordPdtpEvidenceUpload({ path, uploadedByUserId: USER, worksiteId: WS, activityId: ACT, sha256: sha("PDF"), sizeBytes: 3, mimeType: "application/pdf" })
    expect(await uploadRow(path)).toMatchObject({
      path, uploadedByUserId: USER, worksiteId: WS, activityId: ACT, sha256: sha("PDF"), sizeBytes: 3, mimeType: "application/pdf",
    })
  })

  it("una actividad que no existe no tumba la subida: se guarda sin actividad", async () => {
    const path = writeEvidence("sin-actividad.pdf", "PDF")
    await recordPdtpEvidenceUpload({ path, uploadedByUserId: USER, worksiteId: WS, activityId: "no-existe", sha256: sha("PDF"), sizeBytes: 3, mimeType: "application/pdf" })
    expect((await uploadRow(path))?.activityId).toBeNull()
  })

  it("el GC borra la fila del registro del huérfano que borra, y no la de lo que conserva", async () => {
    const old = 25 * 60 * 60 * 1000
    const orphan = writeEvidence("huerfano-registrado.pdf", "O", old)
    const kept = writeEvidence("vinculado-registrado.pdf", "K", old)
    await recordPdtpEvidenceUpload({ path: orphan, uploadedByUserId: USER, worksiteId: WS, sha256: sha("O"), sizeBytes: 1, mimeType: "application/pdf" })
    await recordPdtpEvidenceUpload({ path: kept, uploadedByUserId: USER, worksiteId: WS, sha256: sha("K"), sizeBytes: 1, mimeType: "application/pdf" })
    await insertExecution("exec-1", WS, { evidenceUrl: kept })
    const result = await cleanupPdtpEvidenceOrphans({ olderThanMs: 60 * 60 * 1000 })
    expect(result.deletedNames).toEqual(["huerfano-registrado.pdf"])
    expect(await uploadRow(orphan)).toBeUndefined()
    expect(await uploadRow(kept)).toBeDefined()
  })

  it("en modo de prueba el GC no toca el registro", async () => {
    const orphan = writeEvidence("huerfano-prueba.pdf", "O", 25 * 60 * 60 * 1000)
    await recordPdtpEvidenceUpload({ path: orphan, uploadedByUserId: USER, worksiteId: WS, sha256: sha("O"), sizeBytes: 1, mimeType: "application/pdf" })
    await cleanupPdtpEvidenceOrphans({ olderThanMs: 60 * 60 * 1000, dryRun: true })
    expect(await uploadRow(orphan)).toBeDefined()
  })

  it("el escaneo de integridad usa el sha256 del registro cuando la referencia no guardó uno", async () => {
    const intact = writeEvidence("registro-integro.pdf", "ORIGINAL")
    const altered = writeEvidence("registro-alterado.pdf", "ALTERADO")
    await recordPdtpEvidenceUpload({ path: intact, uploadedByUserId: USER, worksiteId: WS, sha256: sha("ORIGINAL"), sizeBytes: 8, mimeType: "application/pdf" })
    await recordPdtpEvidenceUpload({ path: altered, uploadedByUserId: USER, worksiteId: WS, sha256: sha("ORIGINAL"), sizeBytes: 8, mimeType: "application/pdf" })
    await insertExecution("exec-1", WS, { evidenceUrl: intact })
    await insertExecution("exec-2", WS, { evidenceUrl: altered })
    const result = await scanPdtpEvidenceIntegrity()
    expect(result.withoutChecksum).toBe(0)
    expect(result.checksumMismatchCount).toBe(1)
    expect(result.checksumMismatches[0]).toMatchObject({ path: altered, expected: sha("ORIGINAL"), actual: sha("ALTERADO") })
  })
})

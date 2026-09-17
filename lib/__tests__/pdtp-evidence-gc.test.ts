import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

let tempDir: string
let originalStoragePath: string | undefined

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionCapaEvidence)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  tempDir = mkdtempSync(join(tmpdir(), "pdtp-evidence-gc-"))
  originalStoragePath = process.env.STORAGE_PATH
  process.env.STORAGE_PATH = tempDir
  // Crear la estructura pdtp-evidence
  const { promises: fs } = await import("node:fs")
  await fs.mkdir(join(tempDir, "pdtp-evidence"), { recursive: true })
})

afterEach(() => {
  process.env.STORAGE_PATH = originalStoragePath
  rmSync(tempDir, { recursive: true, force: true })
})

describe("cleanupPdtpEvidenceOrphans", () => {
  it("elimina archivos no referenciados en la DB y mayores al umbral", async () => {
    // Crear 3 archivos: uno referenciado, dos huérfanos
    const referencedName = "abc-referenced.pdf"
    const orphanOldName = "abc-orphan-old.pdf"
    const orphanRecentName = "abc-orphan-recent.pdf"

    writeFileSync(join(tempDir, "pdtp-evidence", referencedName), "PDF_DATA")
    writeFileSync(join(tempDir, "pdtp-evidence", orphanOldName), "PDF_OLD")

    // Mtime antiguo para orphan-old
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2h
    const { utimesSync } = await import("node:fs")
    utimesSync(join(tempDir, "pdtp-evidence", orphanOldName), oldTime, oldTime)

    writeFileSync(join(tempDir, "pdtp-evidence", orphanRecentName), "PDF_NEW")

    // Insertar programa + actividad + ejecución que referencia solo a referencedName
    await inMemoryDb.insert(schema.users).values({
      id: "u1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "w1", name: "W1", code: "W1", isActive: true,
    })
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: "prog-1", year: 2026, version: 1, status: "active", appliesToAllWorksites: true, title: "T",
      elaboratedByName: "X", elaboratedByTitle: "Y",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    await inMemoryDb.insert(schema.pdtpActivities).values({
      id: "act-1", programId: "prog-1", n: 1, activity: "A", program: "P", responsibleSlugs: [], responsibleDisplay: "R",
      sourceSheetRow: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    await inMemoryDb.insert(schema.pdtpExecutions).values({
      id: "exec-1",
      activityId: "act-1",
      worksiteId: "w1",
      year: 2026, month: 1, week: 1,
      executedQuantity: 1,
      status: "approved",
      evidenceUrl: `storage/pdtp-evidence/${referencedName}`,
      evidencePhotos: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupPdtpEvidenceOrphans({ olderThanMs: 60 * 60 * 1000 })

    expect(result.scanned).toBe(3)
    expect(result.deleted).toBe(1)
    expect(result.deletedNames).toEqual([orphanOldName])
    expect(result.kept).toBe(2) // referenced + orphanRecent (reciente)

    // El archivo old no debe existir
    const { existsSync } = await import("node:fs")
    expect(existsSync(join(tempDir, "pdtp-evidence", orphanOldName))).toBe(false)
    expect(existsSync(join(tempDir, "pdtp-evidence", referencedName))).toBe(true)
    expect(existsSync(join(tempDir, "pdtp-evidence", orphanRecentName))).toBe(true)
  })

  it("conserva la evidencia referenciada SÓLO desde prevention_capa_evidence", async () => {
    // Regresión GC-01: el directorio tiene dos productores. La evidencia de
    // cierre de una acción correctiva se sube por el mismo endpoint pero se
    // vincula a `prevention_capa_evidence`, no a `pdtp_executions`. Antes se
    // borraba una hora después de subirla.
    const capaPhotoName = "abc-capa-evidence.jpg"
    const orphanName = "abc-orphan.pdf"
    for (const name of [capaPhotoName, orphanName]) {
      writeFileSync(join(tempDir, "pdtp-evidence", name), "DATA")
    }
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const { utimesSync } = await import("node:fs")
    for (const name of [capaPhotoName, orphanName]) {
      utimesSync(join(tempDir, "pdtp-evidence", name), oldTime, oldTime)
    }

    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.users).values({
      id: "u1", name: "U1", email: "u1@test", hashedPassword: "x", isActive: true,
    })
    await inMemoryDb.insert(schema.worksites).values({
      id: "w1", name: "W1", code: "W1", isActive: true,
    })
    await inMemoryDb.insert(schema.preventionCapaActions).values({
      id: "capa-1", code: "CAPA-2026-0001", sourceType: "pdtp", sourceId: "exec-1",
      worksiteId: "w1", finding: "Hallazgo", actionDescription: "Acción",
      targetDate: "2026-09-01", createdByUserId: "u1", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.preventionCapaEvidence).values({
      id: "capaev-1", actionId: "capa-1", kind: "photo",
      reference: `storage/pdtp-evidence/${capaPhotoName}`,
      uploadedByUserId: "u1", createdAt: now,
    })

    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupPdtpEvidenceOrphans({ olderThanMs: 60 * 60 * 1000 })

    expect(result.deletedNames).toEqual([orphanName])
    const { existsSync } = await import("node:fs")
    expect(existsSync(join(tempDir, "pdtp-evidence", capaPhotoName))).toBe(true)
    expect(existsSync(join(tempDir, "pdtp-evidence", orphanName))).toBe(false)
  })

  it("dryRun=true no elimina archivos", async () => {
    const orphanName = "abc-orphan.pdf"
    writeFileSync(join(tempDir, "pdtp-evidence", orphanName), "PDF_OLD")
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const { utimesSync } = await import("node:fs")
    utimesSync(join(tempDir, "pdtp-evidence", orphanName), oldTime, oldTime)

    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupPdtpEvidenceOrphans({ dryRun: true, olderThanMs: 60 * 60 * 1000 })

    expect(result.deleted).toBe(1)
    expect(result.deletedNames).toEqual([orphanName])

    // En dryRun el archivo sigue existiendo
    const { existsSync } = await import("node:fs")
    expect(existsSync(join(tempDir, "pdtp-evidence", orphanName))).toBe(true)
  })

  it("devuelve resultado vacío si no hay directorio de storage", async () => {
    rmSync(tempDir, { recursive: true, force: true })
    process.env.STORAGE_PATH = originalStoragePath
    const { cleanupPdtpEvidenceOrphans } = await import("@/lib/services/pdtp/evidence-gc")
    const result = await cleanupPdtpEvidenceOrphans()
    expect(result.scanned).toBe(0)
  })
})

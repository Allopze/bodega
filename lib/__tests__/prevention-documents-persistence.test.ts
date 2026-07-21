/**
 * H-28: `lib/services/prevention-documents/crud.ts` no tenía cobertura de
 * persistencia real. `prevention-documents-library.test.ts` sólo cubre Zod
 * y seeds; `prevention-documents-upload-workflow.test.ts` mockea `@/db` a
 * mano (sin SQL real), así que ninguno ejercita el subquery de
 * auto-incremento de versión, las constraints de la tabla ni el alcance por
 * faena leído desde la fila real en BD. Este archivo usa PGlite (Postgres
 * real en memoria) siguiendo el patrón de `prevention-pdtp.test.ts`.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

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

// Los archivos se escriben en disco real (persistFileOnDisk); se redirige a
// un tmp dir para no depender de la config de storage de producción.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const tmpStorageDir = mkdtempSync(join(tmpdir(), "sst-documents-test-"))

vi.mock("@/lib/storage/config", () => ({
  resolveSstDocumentsDir: () => tmpStorageDir,
  createSstDocumentPath: (name: string) => `sst-documents/${name}`,
  resolveSstDocumentFile: (filePath: string) => {
    const prefix = "sst-documents/"
    return filePath.startsWith(prefix) ? join(tmpStorageDir, filePath.slice(prefix.length)) : null
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

beforeEach(async () => {
  await inMemoryDb.delete(schema.sstDocumentAudit)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.statusHistory)
  await inMemoryDb.delete(schema.sstDocumentVersions)
  await inMemoryDb.delete(schema.sstDocuments)
  await inMemoryDb.delete(schema.sstDocumentCategories)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1", name: "Prevencionista", email: "prev@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena A", code: "FA", isActive: true },
    { id: "ws-2", name: "Faena B", code: "FB", isActive: true },
  ])
  await inMemoryDb.insert(schema.sstDocumentCategories).values({
    slug: "gestion_preventiva", name: "Gestión preventiva",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
})

const CTX = { userId: "user-1", userEmail: "prev@example.test" }
const SCOPE_WS1 = { mode: "some" as const, ids: ["ws-1"] }
const SCOPE_WS2 = { mode: "some" as const, ids: ["ws-2"] }

async function createTestDocument(overrides: Partial<{ worksiteId: string; title: string }> = {}) {
  const { createDocument } = await import("@/lib/services/prevention-documents-library")
  return createDocument({
    data: {
      categorySlug: "gestion_preventiva",
      title: overrides.title ?? "Procedimiento de trabajo seguro",
      worksiteId: overrides.worksiteId ?? "ws-1",
    },
    ctx: CTX,
    scope: SCOPE_WS1,
    permissions: ["prevention:docs:manage"],
  })
}

describe("prevention-documents-library — persistencia real (PGlite)", () => {
  it("crea un documento y su bitácora de auditoría", async () => {
    const doc = await createTestDocument()
    expect(doc.status).toBe("borrador")

    const { getDocumentById } = await import("@/lib/services/prevention-documents-library")
    const reloaded = await getDocumentById(doc.id)
    expect(reloaded?.title).toBe("Procedimiento de trabajo seguro")

    const auditRows = await inMemoryDb.select().from(schema.sstDocumentAudit)
    expect(auditRows.some((row) => row.documentId === doc.id && row.action === "create")).toBe(true)
  })

  it("rechaza crear un documento fuera del alcance de faena del usuario", async () => {
    const { createDocument } = await import("@/lib/services/prevention-documents-library")
    await expect(createDocument({
      data: { categorySlug: "gestion_preventiva", title: "Doc ajeno", worksiteId: "ws-2" },
      ctx: CTX,
      scope: SCOPE_WS1,
      permissions: ["prevention:docs:manage"],
    })).rejects.toThrow(/faena/i)
  })

  it("numera versiones sucesivas con el subquery MAX(version)+1 real", async () => {
    const doc = await createTestDocument()
    const { uploadDocumentVersion } = await import("@/lib/services/prevention-documents-library")

    const v1 = await uploadDocumentVersion({
      input: { documentId: doc.id, file: { name: "procedimiento-v1.pdf", type: "application/pdf", size: PDF_BYTES.byteLength, buffer: PDF_BYTES } },
      ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"],
    })
    expect(v1.version).toBe(1)

    const secondBuffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x32])
    const v2 = await uploadDocumentVersion({
      input: { documentId: doc.id, file: { name: "procedimiento-v2.pdf", type: "application/pdf", size: secondBuffer.byteLength, buffer: secondBuffer } },
      ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"],
    })
    expect(v2.version).toBe(2)

    const versions = await inMemoryDb.select().from(schema.sstDocumentVersions)
    expect(versions).toHaveLength(2)
  })

  it("rechaza subir el mismo archivo dos veces (checksum duplicado)", async () => {
    const doc = await createTestDocument()
    const { uploadDocumentVersion } = await import("@/lib/services/prevention-documents-library")
    const input = { documentId: doc.id, file: { name: "procedimiento.pdf", type: "application/pdf", size: PDF_BYTES.byteLength, buffer: PDF_BYTES } }

    await uploadDocumentVersion({ input, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"] })
    await expect(uploadDocumentVersion({ input, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"] }))
      .rejects.toThrow(/ya existe como versión/i)
  })

  it("no permite subir versiones a un documento fuera del alcance de faena (lectura real desde BD)", async () => {
    const doc = await createTestDocument({ worksiteId: "ws-1" })
    const { uploadDocumentVersion } = await import("@/lib/services/prevention-documents-library")
    await expect(uploadDocumentVersion({
      input: { documentId: doc.id, file: { name: "procedimiento.pdf", type: "application/pdf", size: PDF_BYTES.byteLength, buffer: PDF_BYTES } },
      ctx: CTX, scope: SCOPE_WS2, permissions: ["prevention:docs:manage"],
    })).rejects.toThrow(/faena/i)
  })

  it("archiva un documento y sus versiones no publicadas, y permite restaurarlo", async () => {
    const doc = await createTestDocument()
    const { uploadDocumentVersion, archiveDocument, restoreDocument } = await import("@/lib/services/prevention-documents-library")
    await uploadDocumentVersion({
      input: { documentId: doc.id, file: { name: "procedimiento.pdf", type: "application/pdf", size: PDF_BYTES.byteLength, buffer: PDF_BYTES } },
      ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"],
    })

    const archived = await archiveDocument({ input: { documentId: doc.id, comment: "Ya no aplica" }, ctx: CTX, scope: SCOPE_WS1 })
    expect(archived.status).toBe("archivado")
    const [archivedVersion] = await inMemoryDb.select().from(schema.sstDocumentVersions)
    expect(archivedVersion?.status).toBe("archivado")

    const restored = await restoreDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1 })
    expect(restored.status).toBe("borrador")
  })

  it("rechaza restaurar un documento que no está archivado", async () => {
    const doc = await createTestDocument()
    const { restoreDocument } = await import("@/lib/services/prevention-documents-library")
    await expect(restoreDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1 }))
      .rejects.toThrow(/archivados/i)
  })

  it("rechaza subir versiones a un documento ya archivado", async () => {
    const doc = await createTestDocument()
    const { archiveDocument, uploadDocumentVersion } = await import("@/lib/services/prevention-documents-library")
    await archiveDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1 })

    await expect(uploadDocumentVersion({
      input: { documentId: doc.id, file: { name: "procedimiento.pdf", type: "application/pdf", size: PDF_BYTES.byteLength, buffer: PDF_BYTES } },
      ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"],
    })).rejects.toThrow(/archivado/i)
  })
})

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
import { eq } from "drizzle-orm"

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
// un tmp dir para no depender de la config de storage de producción. El backend
// conmutable resuelve el prefijo lógico `storage/sst-documents/` contra este
// tmp dir en modo filesystem.
import { mkdtempSync, promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const tmpStorageDir = mkdtempSync(join(tmpdir(), "sst-documents-test-"))

vi.mock("@/lib/storage/config", () => ({
  resolveSstDocumentsDir: () => tmpStorageDir,
  createSstDocumentPath: (name: string, segments?: readonly string[]) =>
    `storage/sst-documents/${[...(segments ?? []), name].join("/")}`,
  resolveSstDocumentFile: (filePath: string) => {
    const prefix = "storage/sst-documents/"
    if (!filePath.startsWith(prefix)) return null
    const segments = filePath.slice(prefix.length).split("/")
    const isSafe = (segment: string) =>
      Boolean(segment) && segment !== "." && segment !== ".." && !segment.includes("\\")
    if (!segments.every(isSafe)) return null
    return join(tmpStorageDir, ...segments)
  },
}))
vi.mock("@/lib/storage/helpers", () => ({
  mkdirp: async (dir: string) => fs.mkdir(dir, { recursive: true }),
  writeBuffer: async (filePath: string, buffer: Buffer) => fs.writeFile(filePath, buffer),
  readBuffer: async (filePath: string) => fs.readFile(filePath),
  removeFile: async (filePath: string) => fs.unlink(filePath).catch(() => undefined),
}))

// Para ejercitar las acciones de servidor contra la misma BD: la sesión la
// fija cada test con `sessionPermissions`.
const sessionPermissions = vi.hoisted(() => ({ current: [] as string[] }))
vi.mock("@/lib/auth/can", () => ({
  guardPermission: async () => ({
    session: { user: { id: "user-1", email: "prev@example.test", permissions: sessionPermissions.current } },
    error: null,
  }),
}))
vi.mock("@/lib/auth/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/scope")>()),
  resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

beforeEach(async () => {
  await inMemoryDb.delete(schema.sstDocumentAudit)
  await inMemoryDb.delete(schema.sstDocumentLinks)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.statusHistory)
  await inMemoryDb.delete(schema.sstDocumentVersions)
  await inMemoryDb.delete(schema.sstDocuments)
  await inMemoryDb.delete(schema.sstDocumentFolders)
  await inMemoryDb.delete(schema.sstDocumentTypes)
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

  it("el rechazo por alcance es un error de dominio: la acción muestra el motivo", async () => {
    const { createDocument, PreventionDocumentDomainError } = await import("@/lib/services/prevention-documents-library")
    await expect(createDocument({
      data: { categorySlug: "gestion_preventiva", title: "Doc ajeno", worksiteId: "ws-2" },
      ctx: CTX,
      scope: SCOPE_WS1,
      permissions: ["prevention:docs:manage"],
    })).rejects.toBeInstanceOf(PreventionDocumentDomainError)
  })

  /*
   * El diálogo «Mover carpeta» ofrece volver a la raíz, pero el servicio
   * comparaba la faena de un padre inexistente (`undefined`) con la de la
   * carpeta y rechazaba siempre con «No se puede mover la carpeta a otra
   * faena».
   */
  it("mueve una carpeta de vuelta a la raíz", async () => {
    const { createDocumentFolder, moveDocumentFolder } = await import("@/lib/services/prevention-documents-library")
    const parent = await createDocumentFolder({ input: { name: "Raíz de prueba padre", parentId: null, worksiteId: "ws-1" }, ctx: CTX, scope: SCOPE_WS1 })
    const child = await createDocumentFolder({ input: { name: "Raíz de prueba hija", parentId: parent.id, worksiteId: "ws-1" }, ctx: CTX, scope: SCOPE_WS1 })

    await moveDocumentFolder({ input: { id: child.id, parentId: null }, ctx: CTX, scope: SCOPE_WS1 })

    const [moved] = await inMemoryDb.select().from(schema.sstDocumentFolders).where(eq(schema.sstDocumentFolders.id, child.id))
    expect(moved).toMatchObject({ parentId: null, worksiteId: "ws-1" })
    expect((await fs.stat(join(tmpStorageDir, "Raíz de prueba hija"))).isDirectory()).toBe(true)
  })

  it("sigue sin permitir mover una carpeta bajo otra faena", async () => {
    const { createDocumentFolder, moveDocumentFolder, PreventionDocumentDomainError } = await import("@/lib/services/prevention-documents-library")
    const scopeAll = { mode: "all" as const, ids: [] as [] }
    const target = await createDocumentFolder({ input: { name: "Destino faena A", parentId: null, worksiteId: "ws-1" }, ctx: CTX, scope: scopeAll })
    const folder = await createDocumentFolder({ input: { name: "Carpeta faena B", parentId: null, worksiteId: "ws-2" }, ctx: CTX, scope: scopeAll })

    const move = moveDocumentFolder({ input: { id: folder.id, parentId: target.id }, ctx: CTX, scope: scopeAll })
    await expect(move).rejects.toThrow(/otra faena/)
    await expect(move).rejects.toBeInstanceOf(PreventionDocumentDomainError)
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

    const archived = await archiveDocument({ input: { documentId: doc.id, comment: "Ya no aplica" }, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"] })
    expect(archived.status).toBe("archivado")
    const [archivedVersion] = await inMemoryDb.select().from(schema.sstDocumentVersions)
    expect(archivedVersion?.status).toBe("archivado")

    const restored = await restoreDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"] })
    expect(restored.status).toBe("borrador")
  })

  it("rechaza restaurar un documento que no está archivado", async () => {
    const doc = await createTestDocument()
    const { restoreDocument } = await import("@/lib/services/prevention-documents-library")
    await expect(restoreDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"] }))
      .rejects.toThrow(/archivados/i)
  })

  it("rechaza subir versiones a un documento ya archivado", async () => {
    const doc = await createTestDocument()
    const { archiveDocument, uploadDocumentVersion } = await import("@/lib/services/prevention-documents-library")
    await archiveDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"] })

    await expect(uploadDocumentVersion({
      input: { documentId: doc.id, file: { name: "procedimiento.pdf", type: "application/pdf", size: PDF_BYTES.byteLength, buffer: PDF_BYTES } },
      ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"],
    })).rejects.toThrow(/archivado/i)
  })

  it("materializa el árbol de carpetas: subir a una carpeta escribe el archivo en su ruta anidada", async () => {
    const { createDocumentFolder, createDocument, uploadDocumentVersion } = await import("@/lib/services/prevention-documents-library")

    const folder = await createDocumentFolder({
      input: { name: "Procedimientos", parentId: null, worksiteId: "ws-1" },
      ctx: CTX, scope: SCOPE_WS1,
    })
    const doc = await createDocument({
      data: {
        categorySlug: "gestion_preventiva",
        title: "Procedimiento en carpeta",
        worksiteId: "ws-1",
        folderId: folder.id,
      },
      ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"],
    })

    const version = await uploadDocumentVersion({
      input: { documentId: doc.id, file: { name: "procedimiento.pdf", type: "application/pdf", size: PDF_BYTES.byteLength, buffer: PDF_BYTES } },
      ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"],
    })

    // El path lógico incluye el segmento de la carpeta y el archivo existe
    // físicamente en la ruta anidada del backend filesystem.
    expect(version.filePath).toMatch(/^storage\/sst-documents\/Procedimientos\//)
    const physical = join(tmpStorageDir, version.filePath.slice("storage/sst-documents/".length))
    const stat = await fs.stat(physical)
    expect(stat.isFile()).toBe(true)
    // La carpeta física existe.
    expect((await fs.stat(join(tmpStorageDir, "Procedimientos"))).isDirectory()).toBe(true)
  })
})

/*
 * FX-A (A1): archivar, restaurar, vincular, desvincular y regularizar miraban
 * la faena pero no la confidencialidad. Quien no tiene
 * `docs:manage_sensitive` no puede ni abrir un documento sensible (el detalle
 * y la búsqueda lo ocultan), pero sí podía archivarlo o colgarle vínculos
 * conociendo su id.
 */
describe("prevention-documents-library — confidencialidad en acciones sobre el documento", () => {
  const MANAGE_ONLY = ["prevention:docs:manage"] as const
  const WITH_SENSITIVE = ["prevention:docs:manage", "prevention:docs:manage_sensitive"] as const

  async function createSensitiveDocument() {
    const { createDocument } = await import("@/lib/services/prevention-documents-library")
    return createDocument({
      data: { categorySlug: "gestion_preventiva", title: "Informe de investigación reservado", worksiteId: "ws-1", confidentiality: "sensible" },
      ctx: CTX, scope: SCOPE_WS1, permissions: WITH_SENSITIVE,
    })
  }

  it("no archiva ni restaura un documento sensible sin docs:manage_sensitive", async () => {
    const doc = await createSensitiveDocument()
    const { archiveDocument, restoreDocument } = await import("@/lib/services/prevention-documents-library")
    await expect(archiveDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1, permissions: MANAGE_ONLY }))
      .rejects.toThrow(/sensibles/)
    const [still] = await inMemoryDb.select().from(schema.sstDocuments).where(eq(schema.sstDocuments.id, doc.id))
    expect(still?.status).toBe("borrador")

    await archiveDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1, permissions: WITH_SENSITIVE })
    await expect(restoreDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1, permissions: MANAGE_ONLY }))
      .rejects.toThrow(/sensibles/)
  })

  it("no vincula ni desvincula un documento sensible sin docs:manage_sensitive", async () => {
    const doc = await createSensitiveDocument()
    const { createDocumentLink, removeDocumentLink } = await import("@/lib/services/prevention-documents-library")
    await expect(createDocumentLink({
      documentId: doc.id, entityType: "training", entityId: "occ-inexistente", userId: "user-1", scope: SCOPE_WS1, permissions: MANAGE_ONLY,
    })).rejects.toThrow(/sensibles/)

    await inMemoryDb.insert(schema.sstDocumentLinks).values({
      id: "sdlink-1", documentId: doc.id, entityType: "training", entityId: "occ-1", createdAt: new Date().toISOString(),
    })
    await expect(removeDocumentLink({ linkId: "sdlink-1", reason: "Ya no aplica", userId: "user-1", scope: SCOPE_WS1, permissions: MANAGE_ONLY }))
      .rejects.toThrow(/sensibles/)
    const [link] = await inMemoryDb.select().from(schema.sstDocumentLinks).where(eq(schema.sstDocumentLinks.id, "sdlink-1"))
    expect(link?.removedAt).toBeNull()
  })

  it("no regulariza la integridad de un documento sensible sin docs:manage_sensitive", async () => {
    const doc = await createSensitiveDocument()
    const { regularizeDocumentIntegrityFinding } = await import("@/lib/services/prevention-documents-library")
    await expect(regularizeDocumentIntegrityFinding({
      documentId: doc.id, findingCode: "DRAFT_WITH_PUBLISHED_VERSION", action: "clear_invalid_current_version",
      reason: "Regularización de prueba", userId: "user-1", scope: SCOPE_WS1, permissions: MANAGE_ONLY,
    })).rejects.toThrow(/sensibles/)
  })
})

/*
 * FX-A (A4): la biblioteca principal no pasa `status`, y `searchDocuments`
 * sólo excluía archivados cuando se lo pasaban: la papelera se veía también en
 * la lista principal.
 */
describe("searchDocuments — archivados fuera de la lista principal", () => {
  it("sin filtro de estado no devuelve archivados; con status=archivado (papelera) sí", async () => {
    const kept = await createTestDocument({ title: "Documento activo" })
    const trashed = await createTestDocument({ title: "Documento en papelera" })
    const { archiveDocument, searchDocuments } = await import("@/lib/services/prevention-documents-library")
    await archiveDocument({ input: { documentId: trashed.id }, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"] })

    const main = await searchDocuments({ page: 1, pageSize: 50 }, SCOPE_WS1, ["prevention:docs:manage"])
    expect(main.rows.map((row) => row.id)).toEqual([kept.id])
    expect(main.total).toBe(1)

    const trash = await searchDocuments({ status: "archivado", page: 1, pageSize: 50 }, SCOPE_WS1, ["prevention:docs:manage"])
    expect(trash.rows.map((row) => row.id)).toEqual([trashed.id])
  })
})

/*
 * FX-A (A5): restaurar dejaba `borrador` aunque `currentVersionId` siguiera
 * apuntando a una versión vigente (el archivado no toca las vigentes). Eso es
 * exactamente el hallazgo de integridad DRAFT_WITH_PUBLISHED_VERSION y bloquea
 * la distribución del documento restaurado.
 */
describe("restoreDocument — vuelve al estado que su versión vigente sostiene", () => {
  it("restaura como vigente si la versión actual está vigente", async () => {
    const doc = await createTestDocument()
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.sstDocumentVersions).values({
      id: "sdv-vigente", documentId: doc.id, version: 1, status: "vigente", fileName: "p.pdf", storageName: "p.pdf",
      filePath: "storage/sst-documents/p.pdf", mimeType: "application/pdf", fileSize: 6, checksum: "abc",
      uploadedBy: "user-1", approvedBy: "user-1", approvedAt: now, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.update(schema.sstDocuments).set({ status: "vigente", currentVersionId: "sdv-vigente" }).where(eq(schema.sstDocuments.id, doc.id))
    const { archiveDocument, restoreDocument } = await import("@/lib/services/prevention-documents-library")
    await archiveDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"] })

    const restored = await restoreDocument({ input: { documentId: doc.id }, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"] })
    expect(restored.status).toBe("vigente")
    const history = await inMemoryDb.select().from(schema.statusHistory).where(eq(schema.statusHistory.entityId, doc.id))
    expect(history.at(-1)?.toStatus).toBe("vigente")
  })
})

/*
 * FX-A (A6): la carga masiva (y la tipada) no envían `confidentiality`, así que
 * todo quedaba `publico_interno` aunque la persona declarara «Sensible
 * preventivo» o el tipo documental exigiera otra cosa: visible para cualquiera
 * con `docs:view`.
 */
describe("createDocument — la confidencialidad hereda la clase de dato y el tipo", () => {
  it("una clase de dato sensible deja el documento sensible, y exige el permiso", async () => {
    const { createDocument } = await import("@/lib/services/prevention-documents-library")
    const data = { categorySlug: "gestion_preventiva", title: "Evaluación psicosocial", worksiteId: "ws-1", dataClass: "sensitive_preventive" }
    const row = await createDocument({
      data, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage", "prevention:docs:manage_sensitive"],
    })
    expect(row.confidentiality).toBe("sensible")
    await expect(createDocument({ data, ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage"] }))
      .rejects.toThrow(/sensibles/)
  })

  it("un tipo con confidencialidad por defecto la impone al documento", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.sstDocumentTypes).values({
      id: "type-restr", categorySlug: "gestion_preventiva", code: "EXP_PERSONAL", name: "Expediente personal",
      defaultConfidentiality: "restringido", createdAt: now, updatedAt: now,
    })
    const { createDocument } = await import("@/lib/services/prevention-documents-library")
    const row = await createDocument({
      data: { categorySlug: "gestion_preventiva", typeId: "type-restr", title: "Expediente", worksiteId: "ws-1" },
      ctx: CTX, scope: SCOPE_WS1, permissions: ["prevention:docs:manage", "prevention:docs:manage_restricted"],
    })
    expect(row.confidentiality).toBe("restringido")
  })

  it("una clase operacional sin tipo sigue siendo público interno", async () => {
    const row = await createTestDocument()
    expect(row.confidentiality).toBe("publico_interno")
  })
})

/*
 * FX-A (A2): «Nueva versión de…» listaba los documentos del tipo sin filtrar
 * confidencialidad: el título de un documento sensible llegaba a quien no
 * puede abrirlo.
 */
describe("listSstDocumentsOfTypeAction — no filtra títulos de documentos que no se pueden ver", () => {
  it("omite los sensibles sin docs:manage_sensitive y los muestra con él", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.sstDocumentTypes).values({
      id: "type-pts", categorySlug: "gestion_preventiva", code: "PTS", name: "Procedimiento", createdAt: now, updatedAt: now,
    })
    const { createDocument } = await import("@/lib/services/prevention-documents-library")
    const all = ["prevention:docs:manage", "prevention:docs:manage_sensitive"]
    const open = await createDocument({ data: { categorySlug: "gestion_preventiva", typeId: "type-pts", title: "PTS público", worksiteId: "ws-1" }, ctx: CTX, scope: SCOPE_WS1, permissions: all })
    const secret = await createDocument({ data: { categorySlug: "gestion_preventiva", typeId: "type-pts", title: "PTS reservado", worksiteId: "ws-1", confidentiality: "sensible" }, ctx: CTX, scope: SCOPE_WS1, permissions: all })
    const { listSstDocumentsOfTypeAction } = await import("@/app/(app)/prevencion/documentacion/actions/typed-upload")

    sessionPermissions.current = ["prevention:docs:manage"]
    const limited = await listSstDocumentsOfTypeAction({ typeId: "type-pts", worksiteId: "ws-1" })
    expect(limited.data?.documents.map((d) => d.id)).toEqual([open.id])

    sessionPermissions.current = all
    const full = await listSstDocumentsOfTypeAction({ typeId: "type-pts", worksiteId: "ws-1" })
    expect(full.data?.documents.map((d) => d.id).sort()).toEqual([open.id, secret.id].sort())
  })
})

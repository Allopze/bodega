/**
 * lib/__tests__/generated-documents-archive.test.ts
 *
 * Archivado de documentos generados en Cloudreve (decisión del 2026-09-24),
 * con Postgres real (PGlite), un Cloudreve en memoria y el armado de archivos
 * simulado: acá se prueba la cola, no el contenido de cada documento (eso lo
 * cubren las suites de cada módulo con su armador real).
 *
 * 1. Encolar exige las dos llaves (entorno y switch), es idempotente, fecha el
 *    documento en hora de Chile y nunca revierte el hecho de negocio.
 * 2. Procesar sube sin pisar nada, respeta el orden de carpetas, reintenta la
 *    subida desde la copia local y reconoce un PUT que quedó en duda.
 * 3. Los PDF sin sesión no los toma el cron: quedan para el reintento manual,
 *    que exige poder ver el documento.
 */
import path from "node:path"
import { mkdtempSync, promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
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
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const fake = vi.hoisted(() => ({
  remote: new Map<string, Buffer>(),
  collections: [] as string[],
  puts: [] as string[],
  /** Próximos PUT que fallan antes de escribir. */
  failPuts: 0,
  /** Próximo PUT que escribe y después falla (respuesta perdida). */
  ambiguousPut: false,
  produce: vi.fn(),
}))

vi.mock("@/lib/services/cloudreve/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/services/cloudreve/client")>()
  return {
    ...original,
    ensureCloudreveCollections: async (key: string) => { fake.collections.push(key) },
    putCloudreveKey: async (key: string, buffer: Buffer) => {
      fake.puts.push(key)
      if (fake.failPuts > 0) {
        fake.failPuts -= 1
        throw new original.CloudreveError("CLOUDREVE_IO", "caído")
      }
      fake.remote.set(key, buffer)
      if (fake.ambiguousPut) {
        fake.ambiguousPut = false
        throw new original.CloudreveError("CLOUDREVE_TIMEOUT", "sin respuesta")
      }
    },
    statCloudreveKey: async (key: string) => (fake.remote.has(key) ? { size: fake.remote.get(key)!.length } : null),
  }
})
vi.mock("@/lib/services/cloudreve/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/services/cloudreve/settings")>()
  return {
    ...original,
    readCloudreveConfig: async () => ({
      baseUrl: "https://cloudreve.test", username: "u", password: "p", sstPath: "storage/sst-documents", hasCredentials: true,
    }),
  }
})
vi.mock("@/lib/services/generated-documents/renderers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/services/generated-documents/renderers")>()
  return { ...original, produceGeneratedDocument: fake.produce }
})

const storageDir = mkdtempSync(join(tmpdir(), "generated-docs-"))
process.env.STORAGE_PATH = storageDir
process.env.APP_URL = "http://127.0.0.1:3999"

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { enqueueGeneratedDocumentTx } = await import("@/lib/services/generated-documents/enqueue")
const { drainGeneratedDocuments, expireUnrenderedSessionRows } = await import("@/lib/services/generated-documents/drain")
const { retryGeneratedDocument, GeneratedArchiveRetryError } = await import("@/lib/services/generated-documents/admin")
const { GENERATED_ARCHIVE_SETTING_KEYS } = await import("@/lib/services/generated-documents/settings")
const { GeneratedDocumentError } = await import("@/lib/services/generated-documents/renderers")
const { printCredentialFromCookieHeader } = await import("@/lib/pdf/render-print-page")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
  await fs.rm(storageDir, { recursive: true, force: true })
})

const WS = { id: "ws-norte", name: "Faena Norte", code: "FN" }
const XLSX = Buffer.from("PK\u0003\u0004 libro de prueba")
const PDF = Buffer.from("%PDF-1.7 documento de prueba")
const CREDENTIAL = printCredentialFromCookieHeader("authjs.session-token=abc")

async function setSettings(values: { enabled?: boolean; basePath?: string; layout?: string }) {
  const rows: Array<[string, string]> = []
  if (values.enabled !== undefined) rows.push([GENERATED_ARCHIVE_SETTING_KEYS.enabled, values.enabled ? "true" : "false"])
  if (values.basePath !== undefined) rows.push([GENERATED_ARCHIVE_SETTING_KEYS.basePath, values.basePath])
  if (values.layout !== undefined) rows.push([GENERATED_ARCHIVE_SETTING_KEYS.layout, values.layout])
  for (const [key, value] of rows) {
    await inMemoryDb.insert(schema.systemSettings).values({ key, value })
      .onConflictDoUpdate({ target: schema.systemSettings.key, set: { value } })
  }
}

function miperRef(entityId = "miper-1", overrides: Partial<Parameters<typeof enqueueGeneratedDocumentTx>[1]> = {}) {
  return {
    kind: "miper" as const, entityId, milestone: "publicada", worksiteId: WS.id,
    occurredAt: "2026-09-24T15:00:00.000Z", actorUserId: "user-1", ...overrides,
  }
}

async function rows() {
  return inMemoryDb.select().from(schema.generatedDocumentArchives)
}

beforeEach(async () => {
  process.env.GENERATED_DOCS_ARCHIVE_ENABLED = "true"
  await inMemoryDb.delete(schema.generatedDocumentArchives)
  await inMemoryDb.delete(schema.systemSettings)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.insert(schema.worksites).values({ ...WS, isActive: true })
  await setSettings({ enabled: true })
  fake.remote.clear()
  fake.collections.length = 0
  fake.puts.length = 0
  fake.failPuts = 0
  fake.ambiguousPut = false
  fake.produce.mockReset()
  fake.produce.mockImplementation(async (row: { kind: string }) => (
    row.kind === "inspeccion"
      ? { outcome: "document", buffer: PDF, baseName: "INS-2026-0004 - revisada" }
      : { outcome: "document", buffer: XLSX, baseName: "MIPER_Faena Norte_v1" }
  ))
})

describe("encolar", () => {
  it("sin la llave de entorno no encola aunque Administración lo haya encendido", async () => {
    process.env.GENERATED_DOCS_ARCHIVE_ENABLED = "false"
    expect(await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef())).toEqual({ status: "disabled" })
    expect(await rows()).toHaveLength(0)
  })

  it("con el switch apagado no encola", async () => {
    await setSettings({ enabled: false })
    expect(await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef())).toEqual({ status: "disabled" })
    expect(await rows()).toHaveLength(0)
  })

  it("el mismo hecho encolado dos veces es una sola fila, con la faena y el año de Chile", async () => {
    // 02:00 UTC del 1 de enero todavía es 31 de diciembre en Chile.
    const ref = miperRef("miper-1", { occurredAt: "2027-01-01T02:00:00.000Z" })
    const first = await enqueueGeneratedDocumentTx(inMemoryDb as never, ref)
    const second = await enqueueGeneratedDocumentTx(inMemoryDb as never, ref)
    expect(first.status).toBe("queued")
    expect(second).toEqual({ status: "duplicate" })
    const [row] = await rows()
    expect(row).toMatchObject({
      kind: "miper", milestone: "publicada", revision: 1, dedupeKey: "miper:miper-1:publicada:1",
      worksiteLabel: "Faena Norte", documentYear: 2026, renderMode: "inprocess", status: "pending",
    })
  })

  it("un fallo al encolar no revierte la transacción del hecho de negocio", async () => {
    await inMemoryDb.transaction(async (tx) => {
      await tx.insert(schema.worksites).values({ id: "ws-sur", name: "Faena Sur", code: "FS", isActive: true })
      const result = await enqueueGeneratedDocumentTx(tx as never, miperRef("x", { kind: "no-existe" as never }))
      expect(result).toEqual({ status: "failed" })
    })
    const [sur] = await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.id, "ws-sur"))
    expect(sur?.name).toBe("Faena Sur")
    expect(await rows()).toHaveLength(0)
  })
})

describe("procesar y subir", () => {
  it("sube un Excel a la carpeta de su faena, sin sesión, y borra la copia local", async () => {
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef())
    const summary = await drainGeneratedDocuments()
    expect(summary).toMatchObject({ processed: 1, uploaded: 1, failed: 0 })
    const [row] = await rows()
    expect(row).toMatchObject({
      status: "uploaded",
      fileName: "MIPER_Faena Norte_v1.xlsx",
      remoteKey: "Documentos generados/Faena Norte/MIPER_Faena Norte_v1.xlsx",
      sizeBytes: XLSX.length,
    })
    expect(row!.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(fake.collections).toEqual(["Documentos generados/Faena Norte"])
    await expect(fs.stat(join(storageDir, "generated-archive", `${row!.id}.xlsx`))).rejects.toThrow()
  })

  it("con el orden año › faena › módulo usa esa ruta", async () => {
    await setSettings({ layout: "anio_faena_modulo", basePath: "Prevención/Documentos" })
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef())
    await drainGeneratedDocuments()
    const [row] = await rows()
    expect(row!.remoteKey).toBe("Prevención/Documentos/2026/Faena Norte/MIPER/MIPER_Faena Norte_v1.xlsx")
  })

  it("nunca pisa un archivo que ya estaba en Cloudreve: agrega (2)", async () => {
    fake.remote.set("Documentos generados/Faena Norte/MIPER_Faena Norte_v1.xlsx", Buffer.from("PK otro archivo, otro tamaño"))
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef())
    await drainGeneratedDocuments()
    const [row] = await rows()
    expect(row!.remoteKey).toBe("Documentos generados/Faena Norte/MIPER_Faena Norte_v1 (2).xlsx")
    expect(fake.remote.get("Documentos generados/Faena Norte/MIPER_Faena Norte_v1.xlsx")!.toString()).toContain("otro archivo")
  })

  it("dos filas con el mismo nombre no comparten ruta", async () => {
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef("miper-1"))
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef("miper-2"))
    await drainGeneratedDocuments()
    const keys = (await rows()).map((row) => row.remoteKey).sort()
    expect(keys).toEqual([
      "Documentos generados/Faena Norte/MIPER_Faena Norte_v1 (2).xlsx",
      "Documentos generados/Faena Norte/MIPER_Faena Norte_v1.xlsx",
    ])
  })

  it("si Cloudreve falla, la copia local queda y la próxima pasada la sube sin volver a armarla", async () => {
    fake.failPuts = 1
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef())
    const t0 = new Date("2026-09-24T15:00:00.000Z")
    const first = await drainGeneratedDocuments({ now: () => t0 })
    expect(first).toMatchObject({ failed: 1, uploaded: 0 })
    const [staged] = await rows()
    expect(staged).toMatchObject({ status: "staged", lastErrorCode: "CLOUDREVE_IO" })
    expect(staged!.nextAttemptAt).not.toBeNull()

    // Antes del plazo de espera no se reintenta.
    expect((await drainGeneratedDocuments({ now: () => t0 })).processed).toBe(0)

    const later = new Date(t0.getTime() + 60 * 60_000)
    const second = await drainGeneratedDocuments({ now: () => later })
    expect(second).toMatchObject({ uploaded: 1 })
    expect(fake.produce).toHaveBeenCalledTimes(1)
    expect((await rows())[0]!.status).toBe("uploaded")
  })

  it("un PUT que llegó pero perdió la respuesta se reconoce por su clave y su tamaño", async () => {
    fake.ambiguousPut = true
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef())
    const t0 = new Date("2026-09-24T15:00:00.000Z")
    await drainGeneratedDocuments({ now: () => t0 })
    await drainGeneratedDocuments({ now: () => new Date(t0.getTime() + 60 * 60_000) })
    const [row] = await rows()
    expect(row).toMatchObject({ status: "uploaded", remoteKey: "Documentos generados/Faena Norte/MIPER_Faena Norte_v1.xlsx" })
    expect(fake.puts).toHaveLength(1)
  })

  it("una fila que ya no describe el estado actual queda como reemplazada", async () => {
    fake.produce.mockResolvedValueOnce({ outcome: "superseded" })
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef())
    const summary = await drainGeneratedDocuments()
    expect(summary).toMatchObject({ superseded: 1 })
    expect((await rows())[0]!.status).toBe("superseded")
    expect(fake.puts).toHaveLength(0)
  })

  it("con el archivado apagado no procesa nada", async () => {
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef())
    await setSettings({ enabled: false })
    expect(await drainGeneratedDocuments()).toMatchObject({ disabled: true, processed: 0 })
    expect((await rows())[0]!.status).toBe("pending")
  })

  it("dos pasadas simultáneas no procesan la misma fila", async () => {
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef("miper-1"))
    await enqueueGeneratedDocumentTx(inMemoryDb as never, miperRef("miper-2"))
    const [a, b] = await Promise.all([drainGeneratedDocuments(), drainGeneratedDocuments()])
    expect(a.processed + b.processed).toBe(2)
    expect(fake.produce).toHaveBeenCalledTimes(2)
  })
})

describe("PDF que se imprimen con sesión", () => {
  function inspectionRef(actorUserId = "user-1") {
    return {
      // Una fecha ya pasada: el reintento manual la deja marcada como tardía.
      kind: "inspeccion" as const, entityId: "run-1", milestone: "revisada", revision: 3,
      worksiteId: WS.id, occurredAt: "2026-01-10T15:00:00.000Z", actorUserId,
    }
  }

  it("el cron no los toma: no tiene sesión para imprimirlos", async () => {
    await enqueueGeneratedDocumentTx(inMemoryDb as never, inspectionRef())
    expect((await drainGeneratedDocuments()).processed).toBe(0)
    expect(fake.produce).not.toHaveBeenCalled()
  })

  it("el after() de la acción los imprime con la sesión de quien produjo el hecho, y solo esos", async () => {
    await enqueueGeneratedDocumentTx(inMemoryDb as never, inspectionRef("user-1"))
    await enqueueGeneratedDocumentTx(inMemoryDb as never, { ...inspectionRef("user-2"), entityId: "run-2" })
    const summary = await drainGeneratedDocuments({ credential: CREDENTIAL, actorUserId: "user-1" })
    expect(summary).toMatchObject({ processed: 1, uploaded: 1 })
    const uploaded = (await rows()).find((row) => row.status === "uploaded")
    expect(uploaded).toMatchObject({ entityId: "run-1", remoteKey: "Documentos generados/Faena Norte/INS-2026-0004 - revisada.pdf" })
  })

  it("sin acceso a la página queda fallido y el cron no lo reintenta", async () => {
    fake.produce.mockRejectedValueOnce(new GeneratedDocumentError("RENDER_UNAUTHORIZED", "sin acceso"))
    await enqueueGeneratedDocumentTx(inMemoryDb as never, inspectionRef())
    await drainGeneratedDocuments({ credential: CREDENTIAL, actorUserId: "user-1" })
    const [row] = await rows()
    expect(row).toMatchObject({ status: "failed", lastErrorCode: "RENDER_UNAUTHORIZED", nextAttemptAt: null })
    expect((await drainGeneratedDocuments({ now: () => new Date(Date.now() + 24 * 3600_000) })).processed).toBe(0)
  })

  it("lo que nadie imprimió en 30 minutos queda fallido para el reintento manual", async () => {
    await enqueueGeneratedDocumentTx(inMemoryDb as never, inspectionRef())
    await inMemoryDb.update(schema.generatedDocumentArchives).set({ createdAt: "2026-09-24T14:00:00.000Z" })
    const expired = await expireUnrenderedSessionRows(() => new Date("2026-09-24T15:00:00.000Z"))
    expect(expired).toBe(1)
    expect((await rows())[0]).toMatchObject({ status: "failed", lastErrorCode: "RENDER_CREDENTIAL_MISSING" })
  })

  it("el reintento manual exige poder ver el documento y su faena", async () => {
    await enqueueGeneratedDocumentTx(inMemoryDb as never, inspectionRef())
    const [row] = await rows()
    const admin = { userId: "admin-1", permissions: ["admin:storage"], canAccessWorksite: () => true }
    await expect(retryGeneratedDocument(row!.id, admin, CREDENTIAL)).rejects.toBeInstanceOf(GeneratedArchiveRetryError)
    await expect(retryGeneratedDocument(row!.id, {
      ...admin, permissions: ["admin:storage", "prevention:inspections:view"], canAccessWorksite: () => false,
    }, CREDENTIAL)).rejects.toBeInstanceOf(GeneratedArchiveRetryError)

    const summary = await retryGeneratedDocument(row!.id, {
      ...admin, permissions: ["admin:storage", "prevention:inspections:view"],
    }, CREDENTIAL)
    expect(summary).toMatchObject({ uploaded: 1 })
    expect((await rows())[0]).toMatchObject({ status: "uploaded", retriedByUserId: "admin-1", lateRender: true })
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const insertedRows = vi.hoisted(() => [] as Array<Record<string, unknown>>)
const mockUpdate = vi.hoisted(() => vi.fn())
const mockWriteBuffer = vi.hoisted(() => vi.fn(async () => undefined))
const mockMkdirp = vi.hoisted(() => vi.fn(async () => undefined))
const mockRemoveFile = vi.hoisted(() => vi.fn(async () => undefined))
const insertState = vi.hoisted(() => ({ succeeds: true }))
let selectCall = 0

vi.mock("@/db", () => {
  const document = {
    id: "sdoc-1",
    worksiteId: "ws-1",
    confidentiality: "publico_interno",
    status: "vigente",
    currentVersionId: "sdv-current",
    // Sin tipo: el documento no está clasificado y la carga sigue el ciclo de
    // revisión de siempre (ver `resolveDirectPublication`).
    typeId: null,
  }
  // Consultas en orden: el documento, el duplicado por checksum y el bloqueo
  // del documento dentro de la transacción de la carga.
  const rowsForCall = (call: number) => (call === 2 ? [] : [document])
  const client = {
    select: vi.fn(() => {
      selectCall += 1
      const rows = rowsForCall(selectCall)
      const result = {
        limit: vi.fn(async () => rows),
        for: vi.fn(async () => rows),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
      }
      return { from: vi.fn(() => ({ where: vi.fn(() => result) })) }
    }),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedRows.push(values)
        if ("storageName" in values) {
          return {
            returning: vi.fn(async () => insertState.succeeds ? [{ ...values, version: 2 }] : []),
          }
        }
        return Promise.resolve()
      }),
    })),
    update: mockUpdate,
  }
  return { db: { ...client, transaction: vi.fn(async (fn: (tx: typeof client) => unknown) => fn(client)) } }
})

vi.mock("@/lib/storage/helpers", () => ({
  mkdirp: mockMkdirp,
  writeBuffer: mockWriteBuffer,
  removeFile: mockRemoveFile,
}))

vi.mock("@/lib/storage/config", () => ({
  resolveSstDocumentsDir: () => "/tmp/chome-sst-documents-test",
  createSstDocumentPath: (name: string) => `storage/sst-documents/${name}`,
  resolveSstDocumentFile: () => "/tmp/chome-sst-documents-test/orphan.pdf",
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
  recordStatusChange: vi.fn(),
}))

import { uploadDocumentVersion } from "@/lib/services/prevention-documents/crud"

describe("document version upload containment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedRows.length = 0
    selectCall = 0
    insertState.succeeds = true
  })

  it("creates a draft without replacing the currently published version", async () => {
    const buffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

    const version = await uploadDocumentVersion({
      input: {
        documentId: "sdoc-1",
        file: {
          name: "procedimiento-v2.pdf",
          type: "application/pdf",
          size: buffer.byteLength,
          buffer,
        },
        changelog: "Actualiza controles críticos",
      },
      ctx: { userId: "user-prev", userEmail: "prev@example.test" },
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:docs:manage"],
    })

    expect(version.status).toBe("borrador")
    expect(insertedRows[0]).toEqual(expect.objectContaining({
      documentId: "sdoc-1",
      status: "borrador",
      supersedesId: null,
    }))
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(insertedRows[1]).toEqual(expect.objectContaining({
      documentId: "sdoc-1",
      versionId: version.id,
      action: "upload",
      toStatus: "borrador",
    }))
  })

  it("removes the persisted binary when the version row cannot be registered", async () => {
    insertState.succeeds = false
    const buffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

    await expect(uploadDocumentVersion({
      input: {
        documentId: "sdoc-1",
        file: { name: "orphan.pdf", type: "application/pdf", size: buffer.byteLength, buffer },
      },
      ctx: { userId: "user-prev" },
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:docs:manage"],
    })).rejects.toThrow(/registrar la nueva versión/i)

    expect(mockRemoveFile).toHaveBeenCalledWith("/tmp/chome-sst-documents-test/orphan.pdf")
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("blocks likely clinical results before writing them to the general library", async () => {
    const buffer = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

    await expect(uploadDocumentVersion({
      input: {
        documentId: "sdoc-1",
        file: {
          name: "resultado-examen-ocupacional-trabajador.pdf",
          type: "application/pdf",
          size: buffer.byteLength,
          buffer,
        },
      },
      ctx: { userId: "user-prev" },
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:docs:manage"],
    })).rejects.toThrow(/antecedentes clínicos/i)

    expect(mockWriteBuffer).not.toHaveBeenCalled()
  })
})

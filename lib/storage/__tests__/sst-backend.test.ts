import { mkdtempSync, promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const tmpDir = mkdtempSync(path.join(tmpdir(), "sst-backend-test-"))

const mockPut = vi.hoisted(() => vi.fn(async () => undefined))
const mockGet = vi.hoisted(() => vi.fn(async () => Buffer.from("remoto")))
const mockDelete = vi.hoisted(() => vi.fn(async () => undefined))
const mockStat = vi.hoisted(() => vi.fn(async () => ({ size: 6 })))
const mockList = vi.hoisted(() => vi.fn(async () => ["Procedimientos/remoto.pdf"]))
const mockEnsureParent = vi.hoisted(() => vi.fn(async () => undefined))
const mockMove = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock("@/lib/storage/config", () => ({
  createSstDocumentPath: (name: string, segments?: readonly string[]) =>
    `storage/sst-documents/${[...(segments ?? []), name].join("/")}`,
  resolveSstDocumentFile: (filePath: string) => {
    const prefix = "storage/sst-documents/"
    if (!filePath.startsWith(prefix)) return null
    const segments = filePath.slice(prefix.length).split("/")
    const isSafe = (segment: string) =>
      Boolean(segment) && segment !== "." && segment !== ".." && !segment.includes("\\")
    if (!segments.every(isSafe)) return null
    return path.join(tmpDir, ...segments)
  },
  resolveSstDocumentsDir: () => tmpDir,
}))

vi.mock("@/lib/storage/helpers", () => ({
  mkdirp: async (dir: string) => fs.mkdir(dir, { recursive: true }),
  writeBuffer: async (filePath: string, buffer: Buffer) => fs.writeFile(filePath, buffer),
  readBuffer: async (filePath: string) => fs.readFile(filePath),
  removeFile: async (filePath: string) => fs.unlink(filePath),
}))

vi.mock("@/lib/services/cloudreve/client", () => ({
  putCloudreveFile: mockPut,
  getCloudreveFile: mockGet,
  deleteCloudreveFile: mockDelete,
  statCloudreveFile: mockStat,
  listSstFilesRecursive: mockList,
  ensureParentDirs: mockEnsureParent,
  moveCloudreveEntry: mockMove,
  CloudreveError: class CloudreveError extends Error {
    constructor(readonly code: string, message: string) {
      super(message)
      this.name = "CloudreveError"
    }
  },
}))

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }))

import {
  deleteSstDocument,
  listSstStorageFiles,
  moveSstDocument,
  readSstDocument,
  resolveSstBackend,
  statSstDocument,
  writeSstDocument,
} from "@/lib/storage/sst-backend"

describe("sst-backend", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    delete process.env.SST_STORAGE_BACKEND
    await fs.rm(tmpDir, { recursive: true, force: true })
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterEach(() => {
    delete process.env.SST_STORAGE_BACKEND
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("defaults to filesystem", () => {
    expect(resolveSstBackend()).toBe("filesystem")
  })

  it("switches to cloudreve via env", () => {
    process.env.SST_STORAGE_BACKEND = "cloudreve"
    expect(resolveSstBackend()).toBe("cloudreve")
  })

  it("writes and reads nested logical paths through the filesystem backend", async () => {
    const logicalPath = await writeSstDocument("storage/sst-documents/Procedimientos/roundtrip.pdf", Buffer.from("contenido fs"))
    expect(logicalPath).toBe("storage/sst-documents/Procedimientos/roundtrip.pdf")

    const buffer = await readSstDocument(logicalPath)
    expect(buffer.toString("utf8")).toBe("contenido fs")

    const stat = await statSstDocument(logicalPath)
    expect(stat).toEqual({ size: Buffer.byteLength("contenido fs") })

    await deleteSstDocument(logicalPath)
    await expect(statSstDocument(logicalPath)).resolves.toBeNull()
  })

  it("moves files between nested logical paths (filesystem)", async () => {
    const from = await writeSstDocument("storage/sst-documents/A/archivo.pdf", Buffer.from("x"))
    await moveSstDocument(from, "storage/sst-documents/B/archivo.pdf")
    await expect(readSstDocument("storage/sst-documents/B/archivo.pdf")).resolves.toEqual(Buffer.from("x"))
    await expect(statSstDocument(from)).resolves.toBeNull()
  })

  it("rejects paths outside the SST space on read", async () => {
    await expect(readSstDocument("storage/flota/x.pdf")).rejects.toThrow(/fuera del espacio/)
    // Traversal: el prefix pasa pero los segmentos son inválidos → la ruta
    // física no resuelve y el backend la rechaza.
    await expect(readSstDocument("storage/sst-documents/../x.pdf")).rejects.toThrow(/Invalid sst document path/)
  })

  it("routes write/read/stat/delete/move to the cloudreve client when configured", async () => {
    process.env.SST_STORAGE_BACKEND = "cloudreve"

    const logicalPath = await writeSstDocument("storage/sst-documents/remoto.pdf", Buffer.from("x"))
    expect(logicalPath).toBe("storage/sst-documents/remoto.pdf")
    expect(mockEnsureParent).toHaveBeenCalledWith("storage/sst-documents/remoto.pdf")
    expect(mockPut).toHaveBeenCalledWith("storage/sst-documents/remoto.pdf", Buffer.from("x"))

    await expect(readSstDocument(logicalPath)).resolves.toEqual(Buffer.from("remoto"))
    expect(mockGet).toHaveBeenCalledWith(logicalPath)

    await expect(statSstDocument(logicalPath)).resolves.toEqual({ size: 6 })
    expect(mockStat).toHaveBeenCalledWith(logicalPath)

    await deleteSstDocument(logicalPath)
    expect(mockDelete).toHaveBeenCalledWith(logicalPath)

    await moveSstDocument(logicalPath, "storage/sst-documents/Nueva/remoto.pdf")
    expect(mockMove).toHaveBeenCalledWith(logicalPath, "storage/sst-documents/Nueva/remoto.pdf")
  })

  it("lists storage files as logical paths from the active backend", async () => {
    const fsFiles = await listSstStorageFiles()
    expect(fsFiles).toEqual([])

    process.env.SST_STORAGE_BACKEND = "cloudreve"
    await expect(listSstStorageFiles()).resolves.toEqual([
      "storage/sst-documents/Procedimientos/remoto.pdf",
    ])
    expect(mockList).toHaveBeenCalled()
  })
})

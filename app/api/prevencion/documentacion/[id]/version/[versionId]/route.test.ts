import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockCanAny = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn(async () => Buffer.from("document-content")))
const mockRecordDocumentDownload = vi.hoisted(() => vi.fn(async () => undefined))
const dbState = vi.hoisted(() => ({
  doc: null as Record<string, unknown> | null,
  version: null as Record<string, unknown> | null,
  selectCall: 0,
}))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({
  can: mockCan,
  canAny: mockCanAny,
  canAccessWorksite: mockCanAccessWorksite,
}))
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      dbState.selectCall += 1
      const call = dbState.selectCall
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => call === 1
            ? Promise.resolve(dbState.doc ? [dbState.doc] : [])
            : { limit: vi.fn(async () => dbState.version ? [dbState.version] : []) }),
        })),
      }
    }),
  },
}))
vi.mock("@/lib/storage/config", () => ({
  resolveSstDocumentFile: () => "/tmp/document.pdf",
}))
vi.mock("node:fs", () => ({ promises: { readFile: mockReadFile } }))
vi.mock("@/lib/services/prevention-documents-library", () => ({
  recordDocumentDownload: mockRecordDocumentDownload,
}))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }))

function session(permissions: string[] = ["prevention:docs:view"]) {
  return { user: { id: "user-1", permissions } }
}

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: "sdoc-1",
    currentVersionId: "sdv-current",
    worksiteId: "ws-1",
    confidentiality: "publico_interno",
    ...overrides,
  }
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "sdv-draft",
    documentId: "sdoc-1",
    status: "borrador",
    filePath: "sst-documents/document.pdf",
    fileName: "document.pdf",
    mimeType: "application/pdf",
    ...overrides,
  }
}

async function requestVersion() {
  const { GET } = await import("./route")
  return GET(new Request("http://localhost/api/prevencion/documentacion/sdoc-1/version/sdv-draft"), {
    params: Promise.resolve({ id: "sdoc-1", versionId: "sdv-draft" }),
  })
}

describe("GET document version authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.selectCall = 0
    dbState.doc = doc()
    dbState.version = version()
    mockAuth.mockResolvedValue(session())
    mockCan.mockReturnValue(true)
    mockCanAny.mockReturnValue(false)
    mockCanAccessWorksite.mockReturnValue(true)
  })

  it("requires authentication", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await requestVersion()).status).toBe(401)
  })

  it("hides documents from a foreign worksite", async () => {
    mockCanAccessWorksite.mockReturnValue(false)
    expect((await requestVersion()).status).toBe(404)
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it("does not expose a draft to a role with only general view permission", async () => {
    expect((await requestVersion()).status).toBe(404)
    expect(mockCanAny).toHaveBeenCalled()
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it("does not expose a sensitive current version without sensitive access", async () => {
    dbState.doc = doc({ currentVersionId: "sdv-draft", confidentiality: "sensible" })
    dbState.version = version({ status: "vigente" })

    expect((await requestVersion()).status).toBe(404)
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it("allows an authorized workflow reviewer to inspect a same-worksite draft", async () => {
    mockAuth.mockResolvedValue(session(["prevention:docs:view", "prevention:docs:review"]))
    mockCanAny.mockReturnValue(true)

    const response = await requestVersion()

    expect(response.status).toBe(200)
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/document.pdf")
    expect(mockRecordDocumentDownload).toHaveBeenCalledWith(expect.objectContaining({
      documentId: "sdoc-1",
      versionId: "sdv-draft",
      userId: "user-1",
    }))
  })
})

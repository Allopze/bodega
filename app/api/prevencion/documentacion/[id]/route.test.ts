import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn(async () => Buffer.from("document-content")))
const mockRecordDocumentView = vi.hoisted(() => vi.fn(async () => undefined))
const state = vi.hoisted(() => ({ selectCall: 0 }))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan, canAccessWorksite: mockCanAccessWorksite }))
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      state.selectCall++
      const rows = state.selectCall === 1
        ? [{ id: "sdoc-1", status: "vigente", worksiteId: "ws-2", confidentiality: "publico_interno", currentVersionId: "sdv-1" }]
        : [{ id: "sdv-1", documentId: "sdoc-1", status: "vigente", filePath: "storage/sst-documents/file.pdf", fileName: "file.pdf", mimeType: "application/pdf" }]
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => state.selectCall === 1
            ? Promise.resolve(rows)
            : { limit: vi.fn(async () => rows) }),
        })),
      }
    }),
  },
}))
vi.mock("@/lib/storage/config", () => ({ resolveSstDocumentFile: () => "/tmp/document.pdf" }))
vi.mock("node:fs", () => ({ promises: { readFile: mockReadFile } }))
vi.mock("@/lib/services/prevention-documents-library", () => ({
  recordDocumentDownload: vi.fn(),
  recordDocumentView: mockRecordDocumentView,
}))
vi.mock("@/lib/services/prevention-documents/utils", () => ({ canReadDocumentConfidentiality: () => true }))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

describe("GET current document authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.selectCall = 0
    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: ["prevention:docs:view"] } })
    mockCan.mockReturnValue(true)
    mockCanAccessWorksite.mockReturnValue(false)
  })

  it("returns the same 404 for a foreign worksite and never reads the binary", async () => {
    const { GET } = await import("./route")
    const response = await GET(new Request("http://localhost/api/prevencion/documentacion/sdoc-1"), {
      params: Promise.resolve({ id: "sdoc-1" }),
    })

    expect(response.status).toBe(404)
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockRecordDocumentView).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.fn()
const mockCan = vi.fn()
const mockGetDteDocumentPdf = vi.fn()

class MockDteDocumentPdfError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "UNAVAILABLE" | "INVALID_DOCUMENT") {
    super(message)
  }
}

vi.mock("@/lib/auth/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }))
vi.mock("@/lib/auth/can", () => ({ can: (...args: unknown[]) => mockCan(...args) }))
vi.mock("@/lib/services/dte-portal/purchase-document-pdf", () => ({
  getDteDocumentPdf: (...args: unknown[]) => mockGetDteDocumentPdf(...args),
  DteDocumentPdfError: MockDteDocumentPdfError,
}))

const { GET } = await import("./route")

function callGet(id = "dte-1") {
  return GET(new Request(`http://localhost/api/purchase-orders/dtes/${id}/pdf`), {
    params: Promise.resolve({ id }),
  })
}

describe("GET /api/purchase-orders/dtes/[id]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockCan.mockReturnValue(true)
    mockGetDteDocumentPdf.mockResolvedValue({
      buffer: Buffer.from("%PDF-1.7\n"),
      fileName: "DTE-33-45678.pdf",
    })
  })

  it("requires an authenticated purchasing viewer", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await callGet()).status).toBe(401)

    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    mockCan.mockReturnValue(false)
    expect((await callGet()).status).toBe(403)
    expect(mockGetDteDocumentPdf).not.toHaveBeenCalled()
  })

  it("serves the PDF inline with private no-store headers", async () => {
    const response = await callGet()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toContain("inline")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from("%PDF-1.7\n"))
  })

  it("does not reveal a portal or filesystem error when retrieval fails", async () => {
    mockGetDteDocumentPdf.mockRejectedValue(new MockDteDocumentPdfError("ruta /secreta/portal?clave=x", "UNAVAILABLE"))

    const response = await callGet()

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "No se pudo obtener el PDF de la factura" })
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockScope = vi.hoisted(() => vi.fn())
const mockFind = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockScope }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/services/miper/evidence-access", () => ({ findMiperEvidenceForDownload: mockFind }))
vi.mock("node:fs", () => ({ promises: { readFile: mockReadFile } }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { GET } from "./route"

const session = { user: { id: "u-1", permissions: ["prevention:risk:view"], worksiteIds: ["ws-own"] } }
const scope = { mode: "some", ids: ["ws-own"] }

function call(name: string, query = "") {
  const request = new Request(`http://localhost/api/prevencion/miper/evidence/${encodeURIComponent(name)}${query}`)
  return GET(request as never, { params: Promise.resolve({ name }) })
}

describe("GET /api/prevencion/miper/evidence/[name]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(session)
    mockCan.mockReturnValue(true)
    mockScope.mockReturnValue(scope)
    mockReadFile.mockResolvedValue(Buffer.from("contenido"))
  })

  it("401 sin sesión", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call("acta.pdf")).status).toBe(401)
    expect(mockFind).not.toHaveBeenCalled()
  })

  it("403 sin prevention:risk:view", async () => {
    mockCan.mockReturnValue(false)
    const response = await call("acta.pdf")
    expect(response.status).toBe(403)
    expect(mockCan).toHaveBeenCalledWith(session, "prevention:risk:view")
    expect(mockFind).not.toHaveBeenCalled()
  })

  it("400 con un nombre con traversal", async () => {
    expect((await call("../../etc/passwd")).status).toBe(400)
    expect((await call("..\\acta.pdf")).status).toBe(400)
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it("404 si la subida no es evidencia de un registro o está fuera de alcance", async () => {
    mockFind.mockResolvedValue(null)
    const response = await call("acta.pdf")
    expect(response.status).toBe(404)
    expect(mockFind).toHaveBeenCalledWith({}, "storage/miper-evidence/acta.pdf", scope)
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it("PDF inline con nosniff", async () => {
    mockFind.mockResolvedValue({ storedPath: "storage/miper-evidence/acta.pdf", mimeType: "application/pdf", withdrawnAt: null, recordVoidedAt: null })
    const response = await call("acta.pdf")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-type")).toBe("application/pdf")
  })

  it("?descargar=1 fuerza attachment", async () => {
    mockFind.mockResolvedValue({ storedPath: "storage/miper-evidence/acta.pdf", mimeType: "application/pdf", withdrawnAt: null, recordVoidedAt: null })
    const response = await call("acta.pdf", "?descargar=1")
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("un Word va siempre como attachment", async () => {
    mockFind.mockResolvedValue({
      storedPath: "storage/miper-evidence/acta.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", withdrawnAt: null, recordVoidedAt: null,
    })
    const response = await call("acta.docx")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("404 si el archivo no está en disco", async () => {
    mockFind.mockResolvedValue({ storedPath: "storage/miper-evidence/acta.pdf", mimeType: "application/pdf", withdrawnAt: null, recordVoidedAt: null })
    mockReadFile.mockRejectedValue(Object.assign(new Error("no existe"), { code: "ENOENT" }))
    expect((await call("acta.pdf")).status).toBe(404)
  })
})

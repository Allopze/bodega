import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn())
const mockFindFirst = vi.hoisted(() => vi.fn())
const mockResolveFile = vi.hoisted(() => vi.fn())
const mockReadBuffer = vi.hoisted(() => vi.fn())
const mockLogEvidenceAccess = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ canAccessWorksite: mockCanAccessWorksite }))
vi.mock("@/db", () => ({ db: { query: { fuelTaeEvidence: { findFirst: mockFindFirst } } } }))
vi.mock("@/db/schema", () => ({ fuelTaeEvidence: {} }))
vi.mock("@/lib/storage/config", () => ({ resolveFuelTaeEvidenceFile: mockResolveFile }))
vi.mock("@/lib/storage/helpers", () => ({ readBuffer: mockReadBuffer }))
vi.mock("@/lib/combustibles/evidence-management", () => ({ logEvidenceAccess: mockLogEvidenceAccess }))
vi.mock("@/lib/services/module-toggles", () => ({
  isRouteOperational: vi.fn(async () => true),
}))

const session = { user: { id: "user-1" } }

async function callRoute(id: string) {
  const { GET } = await import("./route")
  return GET({} as Request, { params: Promise.resolve({ id }) })
}

/**
 * Sección 19 — "Evidencia inaccesible sin permiso": confirma que la ruta
 * devuelve 404 (no 403) cuando la evidencia existe pero la faena está fuera
 * del alcance del usuario — 403 confirmaría que el registro existe, 404 no.
 */
describe("GET /api/tae/evidence/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(session)
    mockCan.mockReturnValue(true)
  })

  it("rechaza sin combustibles:tae_view con 403", async () => {
    mockCan.mockReturnValue(false)
    const res = await callRoute("ev-1")
    expect(res.status).toBe(403)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it("devuelve 404 (no 403) cuando la evidencia no existe", async () => {
    mockFindFirst.mockResolvedValueOnce(undefined)
    const res = await callRoute("ev-missing")
    expect(res.status).toBe(404)
  })

  it("devuelve 404 (no 403) cuando la evidencia existe pero la faena está fuera del alcance — no confirma su existencia", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "ev-1", submission: { worksiteId: "ws-other" }, filePath: "x.jpg", mimeType: "image/jpeg" })
    mockCanAccessWorksite.mockReturnValueOnce(false)
    const res = await callRoute("ev-1")
    expect(res.status).toBe(404)
    expect(mockLogEvidenceAccess).not.toHaveBeenCalled()
  })

  it("sirve el archivo y registra el acceso cuando todo encaja", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "ev-1", submission: { worksiteId: "ws-1" }, filePath: "x.jpg", mimeType: "image/jpeg", externalUrl: null })
    mockCanAccessWorksite.mockReturnValueOnce(true)
    mockResolveFile.mockReturnValueOnce("/srv/x.jpg")
    mockReadBuffer.mockResolvedValueOnce(Buffer.from([1, 2, 3]))
    const res = await callRoute("ev-1")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/jpeg")
    expect(mockLogEvidenceAccess).toHaveBeenCalledWith("ev-1", "user-1", "view")
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn())
const mockAssertWorksiteAccess = vi.hoisted(() => vi.fn())
const mockResolvePdtpEvidenceFile = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockResolveWorksiteScope }))
vi.mock("@/lib/services/prevention-pdtp", () => ({ assertWorksiteAccess: mockAssertWorksiteAccess }))
vi.mock("@/lib/storage/config", () => ({ resolvePdtpEvidenceFile: mockResolvePdtpEvidenceFile }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

// Drizzle db shim: any select chain resolves to [{ worksiteId }] or [].
const queryResult = vi.hoisted(() => ({ rows: [] as Array<{ worksiteId: string }> }))
vi.mock("@/db", () => ({
  get db() {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(queryResult.rows),
          }),
        }),
      }),
    }
  },
}))
vi.mock("@/db/schema", () => ({ pdtpExecutions: {} }))
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    promises: { ...actual.promises, readFile: (...args: unknown[]) => mockReadFile(...args) },
  }
})

const session = { user: { id: "u-1", permissions: ["prevention:pdtp:view"] } }

function makeRequest(name: string): Request {
  return { url: `http://test/api/prevencion/pdtp/evidence/${name}` } as unknown as Request
}

describe("GET /api/prevencion/pdtp/evidence/[name]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryResult.rows = []
    mockAuth.mockResolvedValue(session)
    mockCan.mockReturnValue(true)
    mockResolveWorksiteScope.mockReturnValue({ mode: "all", ids: [] })
    mockAssertWorksiteAccess.mockReturnValue(undefined)
    mockResolvePdtpEvidenceFile.mockImplementation((p: string) => `/srv/${p}`)
    mockReadFile.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
  })

  it("rechaza sin sesión con 401", async () => {
    mockAuth.mockResolvedValueOnce(null)
    const { GET } = await import("./route")
    const res = await GET(makeRequest("abc.jpg") as never, { params: Promise.resolve({ name: "abc.jpg" }) })
    expect(res.status).toBe(401)
  })

  it("rechaza sin permiso con 403", async () => {
    mockCan.mockReturnValueOnce(false)
    const { GET } = await import("./route")
    const res = await GET(makeRequest("abc.jpg") as never, { params: Promise.resolve({ name: "abc.jpg" }) })
    expect(res.status).toBe(403)
  })

  it("rechaza rutas inválidas (path traversal) con 400", async () => {
    mockResolvePdtpEvidenceFile.mockReturnValueOnce(null)
    const { GET } = await import("./route")
    const res = await GET(makeRequest("..%2Fpasswd") as never, { params: Promise.resolve({ name: "..%2Fpasswd" }) })
    expect(res.status).toBe(400)
  })

  it("devuelve 404 si la evidencia no está asociada a ninguna ejecución del scope", async () => {
    queryResult.rows = []
    const { GET } = await import("./route")
    const res = await GET(makeRequest("abc.jpg") as never, { params: Promise.resolve({ name: "abc.jpg" }) })
    expect(res.status).toBe(404)
  })

  it("rechaza con 404 si el dueño de la evidencia está fuera del scope del usuario (sin distinguir existencia)", async () => {
    queryResult.rows = [{ worksiteId: "ws-other" }]
    mockResolveWorksiteScope.mockReturnValueOnce({ mode: "some", ids: ["ws-1"] })
    mockAssertWorksiteAccess.mockImplementationOnce(() => {
      throw new Error("Actividad PDTP no encontrada o sin acceso a la faena.")
    })
    const { GET } = await import("./route")
    const res = await GET(makeRequest("abc.jpg") as never, { params: Promise.resolve({ name: "abc.jpg" }) })
    expect(res.status).toBe(404)
  })

  it("sirve el archivo con el content-type correcto cuando todo encaja", async () => {
    queryResult.rows = [{ worksiteId: "ws-1" }]
    mockResolveWorksiteScope.mockReturnValueOnce({ mode: "some", ids: ["ws-1"] })
    const { GET } = await import("./route")
    const res = await GET(makeRequest("foto.jpg") as never, { params: Promise.resolve({ name: "foto.jpg" }) })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/jpeg")
  })

  it("sirve PDFs con application/pdf", async () => {
    queryResult.rows = [{ worksiteId: "ws-1" }]
    const { GET } = await import("./route")
    const res = await GET(makeRequest("doc.pdf") as never, { params: Promise.resolve({ name: "doc.pdf" }) })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
  })

  it("devuelve 404 si el archivo físico no existe (ENOENT)", async () => {
    queryResult.rows = [{ worksiteId: "ws-1" }]
    const err = Object.assign(new Error("missing"), { code: "ENOENT" })
    mockReadFile.mockRejectedValueOnce(err)
    const { GET } = await import("./route")
    const res = await GET(makeRequest("ghost.jpg") as never, { params: Promise.resolve({ name: "ghost.jpg" }) })
    expect(res.status).toBe(404)
  })
})

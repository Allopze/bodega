import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockScope = vi.hoisted(() => vi.fn())
const mockGetRiskImportSourceFile = vi.hoisted(() => vi.fn())
const mockReadBuffer = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockScope }))
vi.mock("@/lib/services/prevention-risk-import", () => ({ getRiskImportSourceFile: mockGetRiskImportSourceFile }))
vi.mock("@/lib/storage/helpers", () => ({ readBuffer: mockReadBuffer }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))

function session(permissions: string[] = ["prevention:risk:view"]) {
  return {
    user: {
      id: "risk-user", email: "riesgos@chome.cl", permissions,
      roles: ["prevencionista_faena"], worksiteIds: ["ws-own"], isGlobal: false,
    },
  }
}

describe("GET original MIPER import", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockCan.mockReturnValue(false)
    mockScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
    mockGetRiskImportSourceFile.mockResolvedValue({
      absolutePath: "/storage/risk-imports/source.xlsx",
      batch: { id: "batch-1", sourceFileName: "MIPER original.xlsx", sourceChecksumSha256: "source-hash" },
    })
    mockReadBuffer.mockResolvedValue(Buffer.from([1, 2, 3]))
  })

  it("requires authentication and view permission before touching storage", async () => {
    const { GET } = await import("./route")
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "batch-1" }) })).status).toBe(401)

    mockAuth.mockResolvedValue(session([]))
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "batch-1" }) })).status).toBe(403)
    expect(mockGetRiskImportSourceFile).not.toHaveBeenCalled()
    expect(mockReadBuffer).not.toHaveBeenCalled()
  })

  it("loads the binary only after the service validates exact scope", async () => {
    mockAuth.mockResolvedValue(session())
    mockCan.mockReturnValue(true)
    const { GET } = await import("./route")

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "batch-1" }) })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("spreadsheetml")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mockGetRiskImportSourceFile).toHaveBeenCalledWith("batch-1", {
      userId: "risk-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:risk:view"],
    })
    expect(mockReadBuffer).toHaveBeenCalledWith("/storage/risk-imports/source.xlsx")
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: "prevention_risk_import_batch", entityId: "batch-1" }))
  })

  it("returns an indistinguishable 404 and never reads a foreign batch", async () => {
    mockAuth.mockResolvedValue(session())
    mockCan.mockReturnValue(true)
    mockGetRiskImportSourceFile.mockRejectedValue(new Error("fuera de alcance"))
    const { GET } = await import("./route")

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "batch-foreign" }) })

    expect(response.status).toBe(404)
    expect(mockReadBuffer).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})

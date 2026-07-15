import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: vi.fn(() => ({ mode: "all", ids: [] })) }))
vi.mock("@/lib/services/prevention-indicadores", () => ({
  listVisibleWorksites: vi.fn(),
  getSafetyIndicators: vi.fn(),
  buildMonthlyCounters: vi.fn(),
  calcRates: vi.fn(),
}))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

describe("GET /api/prevencion/indicadores/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockCan.mockReturnValue(false)
  })

  it("requiere una sesión autenticada", async () => {
    const { GET } = await import("./route")

    const response = await GET(new NextRequest("http://localhost/api/prevencion/indicadores/export?year=2026"))

    expect(response.status).toBe(401)
  })

  it("requiere prevention:indicadores:view", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u-1", permissions: [] } })
    const { GET } = await import("./route")

    const response = await GET(new NextRequest("http://localhost/api/prevencion/indicadores/export?year=2026"))

    expect(response.status).toBe(403)
    expect(mockCan).toHaveBeenCalledWith(expect.anything(), "prevention:indicadores:view")
  })
})

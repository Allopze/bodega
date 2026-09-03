import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockGetTrazabilidadXlsx = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/services/trazabilidad-export", () => ({
  getTrazabilidadXlsx: mockGetTrazabilidadXlsx,
}))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

describe("GET /api/bodega/trazabilidad/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "u-1", permissions: ["warehouse:view_traceability"] } })
    mockCan.mockImplementation((_session, permission) => permission === "warehouse:view_traceability")
    mockGetTrazabilidadXlsx.mockResolvedValue({
      buffer: Buffer.from("xlsx"),
      filename: "trazabilidad.xlsx",
      truncated: false,
    })
  })

  it("allows users with warehouse:view_traceability permission", async () => {
    const { GET } = await import("./route")

    const response = await GET(new NextRequest("http://localhost/api/bodega/trazabilidad/export"))

    expect(response.status).toBe(200)
    expect(mockCan).toHaveBeenCalledWith(expect.anything(), "warehouse:view_traceability")
  })

  it("returns 403 when lacking warehouse:view_traceability permission", async () => {
    mockCan.mockReturnValue(false)
    const { GET } = await import("./route")

    const response = await GET(new NextRequest("http://localhost/api/bodega/trazabilidad/export"))

    expect(response.status).toBe(403)
  })
})

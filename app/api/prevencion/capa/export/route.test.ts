import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockBuild = vi.hoisted(() => vi.fn())
const mockXlsx = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/services/prevention-capa", () => ({ buildCapaExport: mockBuild }))
vi.mock("@/lib/reports/export", () => ({ buildXlsxBuffer: mockXlsx }))

import { GET } from "./route"

function session(permissions: string[]) {
  return { user: { id: "u1", permissions, roles: ["prevencionista_faena"], worksiteIds: ["w1"], isGlobal: false } }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockBuild.mockResolvedValue({ filenameBase: "capa", worksheetName: "CAPA", headers: [], rows: [] })
  mockXlsx.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
})

describe("GET CAPA Excel", () => {
  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })

  it("returns 403 without CAPA view permission", async () => {
    mockAuth.mockResolvedValue(session(["prevention:pdtp:view"]))
    expect((await GET()).status).toBe(403)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("exports Excel within the exact worksite scope", async () => {
    mockAuth.mockResolvedValue(session(["prevention:capa:view"]))
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("spreadsheetml")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mockBuild).toHaveBeenCalledWith({
      scope: { mode: "some", ids: ["w1"] },
      permissions: ["prevention:capa:view"],
    })
  })
})

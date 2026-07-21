import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCreate = vi.hoisted(() => vi.fn())
const mockResolveScope = vi.hoisted(() => vi.fn(() => ({ mode: "some", ids: ["ws-1"] })))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockResolveScope }))
vi.mock("@/lib/services/prevention-reserved-cases", () => ({
  createPreventionReservedCase: mockCreate,
}))

function session(permissions: string[]) {
  return { user: { id: "investigator-1", email: "investigator@chome.cl", permissions } }
}

describe("POST /api/prevencion/casos-reservados", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: "prc-1", code: "RES-2026-0001", status: "abierto" })
  })

  it("requires authentication and the nominated investigator permission", async () => {
    const { POST } = await import("./route")
    const request = () => new Request("http://localhost/api/prevencion/casos-reservados", {
      method: "POST",
      body: JSON.stringify({ worksiteId: "ws-1" }),
    })

    expect((await POST(request())).status).toBe(401)
    mockAuth.mockResolvedValue(session(["prevention:docs:view"]))
    expect((await POST(request())).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("creates through the scoped encrypted service and disables caching", async () => {
    mockAuth.mockResolvedValue(session(["prevention:reserved_case:investigate"]))
    const { POST } = await import("./route")
    const input = {
      worksiteId: "ws-1",
      category: "ley_karin",
      payload: { reporter: "reservado" },
      memberUserIds: ["reviewer-1"],
    }

    const response = await POST(new Request("http://localhost/api/prevencion/casos-reservados", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "vitest" },
      body: JSON.stringify(input),
    }))

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input,
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:reserved_case:investigate"],
      ctx: expect.objectContaining({ userId: "investigator-1", userAgent: "vitest" }),
    }))
  })
})

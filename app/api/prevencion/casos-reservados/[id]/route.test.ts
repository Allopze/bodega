import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockGet = vi.hoisted(() => vi.fn())
const mockResolveScope = vi.hoisted(() => vi.fn(() => ({ mode: "some", ids: ["ws-1"] })))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockResolveScope }))
vi.mock("@/lib/services/prevention-reserved-cases", () => ({
  getPreventionReservedCase: mockGet,
}))

function requestCase(query = "?purpose=investigacion%20formal") {
  return new Request(`http://localhost/api/prevencion/casos-reservados/prc-1${query}`, {
    headers: { "user-agent": "vitest" },
  })
}

async function callGet(query?: string) {
  const { GET } = await import("./route")
  return GET(requestCase(query), { params: Promise.resolve({ id: "prc-1" }) })
}

describe("GET /api/prevencion/casos-reservados/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockGet.mockResolvedValue({
      id: "prc-1",
      code: "RES-2026-0001",
      status: "abierto",
      payload: { testimony: "contenido reservado" },
    })
  })

  it("requires authentication and an explicit access purpose", async () => {
    expect((await callGet()).status).toBe(401)
    mockAuth.mockResolvedValue({ user: { id: "investigator-1", permissions: [] } })
    expect((await callGet("")).status).toBe(400)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it("uses one indistinguishable 404 for general roles, foreign worksites and non-members", async () => {
    mockAuth.mockResolvedValue({ user: { id: "prev-general", permissions: ["prevention:docs:view"] } })
    mockGet.mockRejectedValue(new Error("Caso no encontrado o fuera de alcance."))

    const response = await callGet()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Caso no encontrado o fuera de alcance" })
  })

  it("returns content only after the scoped membership service authorizes it", async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: "investigator-1",
        email: "investigator@chome.cl",
        permissions: ["prevention:reserved_case:view"],
      },
    })

    const response = await callGet()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(mockGet).toHaveBeenCalledWith(expect.objectContaining({
      caseId: "prc-1",
      purpose: "investigacion formal",
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:reserved_case:view"],
      ctx: expect.objectContaining({ userId: "investigator-1" }),
    }))
  })
})

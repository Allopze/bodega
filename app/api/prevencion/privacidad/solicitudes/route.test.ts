import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockList = vi.hoisted(() => vi.fn())
const mockCreate = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-privacy", () => ({
  listPreventionPrivacyRequests: mockList,
  createPreventionPrivacyRequest: mockCreate,
}))

function session(permissions: string[]) {
  return { user: { id: "privacy-manager", email: "privacy@chome.cl", permissions } }
}

describe("privacy request collection API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockList.mockResolvedValue([])
    mockCreate.mockResolvedValue({ id: "ppr-1", status: "recibida" })
  })

  it("protects listing and creation with the dedicated management permission", async () => {
    const { GET, POST } = await import("./route")
    const postRequest = () => new Request("http://localhost/api/prevencion/privacidad/solicitudes", {
      method: "POST",
      body: JSON.stringify({ subjectWorkerId: "worker-1" }),
    })
    expect((await GET()).status).toBe(401)
    expect((await POST(postRequest())).status).toBe(401)

    mockAuth.mockResolvedValue(session(["prevention:privacy:audit"]))
    expect((await GET()).status).toBe(403)
    expect((await POST(postRequest())).status).toBe(403)
    expect(mockList).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("creates in the session worksite scope and returns no-store", async () => {
    mockAuth.mockResolvedValue(session(["prevention:privacy:manage_requests"]))
    const { POST } = await import("./route")
    const input = { subjectWorkerId: "worker-1", rightType: "access", requestScope: "antecedentes de salud" }
    const response = await POST(new Request("http://localhost/api/prevencion/privacidad/solicitudes", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "vitest" },
      body: JSON.stringify(input),
    }))

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input,
      scope: { mode: "some", ids: ["ws-1"] },
      permissions: ["prevention:privacy:manage_requests"],
      ctx: expect.objectContaining({ userId: "privacy-manager", userAgent: "vitest" }),
    }))
  })
})

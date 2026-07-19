import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockExecute = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-privacy-rights", () => ({ executePreventionPrivacyRight: mockExecute }))

async function post() {
  const { POST } = await import("./route")
  return POST(new Request("http://localhost/api/prevencion/privacidad/solicitudes/ppr-1/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: "health_record", entityId: "health-1", operation: "deletion", reason: "motivo fundado", changes: {} }),
  }), { params: Promise.resolve({ id: "ppr-1" }) })
}

describe("POST privacy right execution", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecute.mockResolvedValue({ id: "execution-1", outcome: "applied" })
  })

  it("rejects a general prevention role before invoking the domain service", async () => {
    mockAuth.mockResolvedValue({ user: { id: "general", permissions: ["prevention:docs:view"] } })
    expect((await post()).status).toBe(403)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it("forces the request id from the URL and returns a no-store response", async () => {
    mockAuth.mockResolvedValue({ user: { id: "manager", email: "m@test", permissions: ["prevention:privacy:manage_requests"] } })
    const response = await post()
    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ requestId: "ppr-1" }),
    }))
  })
})

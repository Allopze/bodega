import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockTransition = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-privacy", () => ({
  transitionPreventionPrivacyRequest: mockTransition,
}))

async function callPatch(body: Record<string, unknown>) {
  const { PATCH } = await import("./route")
  return PATCH(new Request("http://localhost/api/prevencion/privacidad/solicitudes/ppr-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "ppr-1" }) })
}

describe("privacy request transition API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockTransition.mockResolvedValue({ id: "ppr-1", status: "en_proceso" })
  })

  it("requires dedicated management permission", async () => {
    expect((await callPatch({ toStatus: "en_proceso" })).status).toBe(401)
    mockAuth.mockResolvedValue({ user: { id: "auditor", permissions: ["prevention:privacy:audit"] } })
    expect((await callPatch({ toStatus: "en_proceso" })).status).toBe(403)
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it("forces the URL id and returns an indistinguishable 404 for foreign scope", async () => {
    mockAuth.mockResolvedValue({ user: { id: "manager", permissions: ["prevention:privacy:manage_requests"] } })
    mockTransition.mockRejectedValue(new Error("Solicitud no encontrada o fuera de alcance."))
    const response = await callPatch({ requestId: "foreign", toStatus: "en_proceso" })

    expect(response.status).toBe(404)
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ requestId: "ppr-1", toStatus: "en_proceso" }),
      scope: { mode: "some", ids: ["ws-1"] },
    }))
  })
})

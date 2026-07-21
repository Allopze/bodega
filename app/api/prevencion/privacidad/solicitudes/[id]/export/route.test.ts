import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockBuild = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all", ids: [] }) }))
vi.mock("@/lib/services/prevention-privacy-export", () => ({
  buildPreventionPrivacySubjectExport: mockBuild,
}))

async function callExport(query = "?purpose=derecho%20de%20acceso") {
  const { GET } = await import("./route")
  return GET(new Request(`http://localhost/api/prevencion/privacidad/solicitudes/ppr-1/export${query}`), {
    params: Promise.resolve({ id: "ppr-1" }),
  })
}

describe("GET privacy subject export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockBuild.mockResolvedValue({
      bytes: Buffer.from("xlsx"),
      checksumSha256: "a".repeat(64),
      requestId: "ppr-1",
    })
  })

  it("requires authentication, dedicated permission and purpose", async () => {
    expect((await callExport()).status).toBe(401)
    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: [] } })
    expect((await callExport()).status).toBe(403)
    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: ["prevention:privacy:export_subject"] } })
    expect((await callExport("")).status).toBe(400)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("returns a no-store XLSX and propagates the clinical opt-in", async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        permissions: ["prevention:privacy:export_subject", "prevention:health:view_clinical"],
      },
    })
    const response = await callExport("?purpose=entrega%20verificada&includeClinical=1")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("spreadsheetml")
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("x-privacy-export-checksum")).toBe("a".repeat(64))
    expect(mockBuild).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "ppr-1",
      includeClinical: true,
      purpose: "entrega verificada",
    }))
  })
})

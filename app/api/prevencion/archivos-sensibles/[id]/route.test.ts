import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockRead = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-1"] }) }))
vi.mock("@/lib/services/prevention-sensitive-files", () => ({ readPreventionSensitiveFile: mockRead }))

async function get(purpose = "revision autorizada") {
  const { GET } = await import("./route")
  return GET(new Request(`http://localhost/api/prevencion/archivos-sensibles/file-1?purpose=${encodeURIComponent(purpose)}`), {
    params: Promise.resolve({ id: "file-1" }),
  })
}

describe("GET sensitive prevention file", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: ["prevention:docs:view"] } })
  })

  it("does not reveal whether a file exists when permission/scope/membership fails", async () => {
    mockRead.mockRejectedValue(new Error("Archivo no encontrado o fuera de alcance."))
    const response = await get()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Archivo no encontrado o fuera de alcance" })
  })

  it("requires an explicit access purpose", async () => {
    expect((await get("")).status).toBe(400)
    expect(mockRead).not.toHaveBeenCalled()
  })
})

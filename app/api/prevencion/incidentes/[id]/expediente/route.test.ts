import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const canMock = vi.fn()
const exportMock = vi.fn()
const buildMock = vi.fn()

vi.mock("@/lib/auth/auth", () => ({ auth: authMock }))
vi.mock("@/lib/auth/can", () => ({ can: canMock }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "some", ids: ["ws-a"] }) }))
vi.mock("@/lib/services/prevention-incident-export", () => ({ buildIncidentCaseExport: exportMock }))
vi.mock("@/lib/reports/export", () => ({ buildXlsxBuffer: buildMock }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

const session = {
  user: { id: "incident-user", permissions: ["prevention:incidents:view", "prevention:incidents:export"] },
}

describe("incident case export endpoint authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(session)
    canMock.mockImplementation((_session, permission: string) => session.user.permissions.includes(permission))
  })

  it("does not invoke the exporter when the role lacks export permission", async () => {
    session.user.permissions = ["prevention:incidents:view"]
    const { GET } = await import("./route")
    const response = await GET(new NextRequest("http://localhost/api/prevencion/incidentes/inc-1/expediente"), { params: Promise.resolve({ id: "inc-1" }) } as never)
    expect(response.status).toBe(404)
    expect(exportMock).not.toHaveBeenCalled()
  })

  it("returns the same 404 when the service hides a foreign-worksite incident", async () => {
    session.user.permissions = ["prevention:incidents:view", "prevention:incidents:export"]
    exportMock.mockResolvedValue(null)
    const { GET } = await import("./route")
    const response = await GET(new NextRequest("http://localhost/api/prevencion/incidentes/inc-foreign/expediente"), { params: Promise.resolve({ id: "inc-foreign" }) } as never)
    expect(response.status).toBe(404)
    expect(exportMock).toHaveBeenCalledWith(expect.objectContaining({
      incidentId: "inc-foreign",
      access: expect.objectContaining({ scope: { mode: "some", ids: ["ws-a"] } }),
    }))
  })

  it("requires the nominative sensitive permission before invoking a reserved export", async () => {
    session.user.permissions = ["prevention:incidents:view", "prevention:incidents:export"]
    const { GET } = await import("./route")
    const response = await GET(new NextRequest("http://localhost/api/prevencion/incidentes/inc-1/expediente?includeSensitive=1&purpose=investigacion"), { params: Promise.resolve({ id: "inc-1" }) } as never)
    expect(response.status).toBe(404)
    expect(exportMock).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockGetFindings = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all", ids: [] }) }))
vi.mock("@/lib/services/prevention-documents-library", () => ({
  getDocumentIntegrityFindings: mockGetFindings,
}))

describe("GET document integrity XLSX", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockCan.mockReturnValue(false)
    mockGetFindings.mockResolvedValue([])
  })

  it("requires authentication and publication authority", async () => {
    const { GET } = await import("./route")
    expect((await GET()).status).toBe(401)

    mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: [] } })
    expect((await GET()).status).toBe(403)
    expect(mockCan).toHaveBeenCalledWith(expect.anything(), "prevention:docs:publish")
  })

  it("exports an explicit non-usable evidence register as XLSX", async () => {
    mockAuth.mockResolvedValue({ user: { id: "jefa-1", permissions: ["prevention:docs:publish"] } })
    mockCan.mockReturnValue(true)
    mockGetFindings.mockResolvedValue([{
      severity: "critico",
      code: "PUBLISHED_WITHOUT_APPROVER",
      documentId: "sdoc-1",
      documentTitle: "Procedimiento crítico",
      versionId: "sdv-1",
      detail: "Versión vigente sin aprobador.",
      recommendedAction: "Retirar y regularizar.",
      evidenceUsable: false,
    }])
    const { GET } = await import("./route")

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("spreadsheetml")
    const Excel = await import("exceljs")
    const workbook = new Excel.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer())
    expect(workbook.getWorksheet("Regularización")?.getCell("I2").value).toBe("No")
    expect(workbook.getWorksheet("Advertencia")?.getCell("A1").value).toMatch(/no utilizable/i)
  })
})

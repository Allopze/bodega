import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockScope = vi.hoisted(() => vi.fn())
const mockGetLegalDashboard = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockScope }))
vi.mock("@/lib/services/prevention-risk-legal", () => ({ getLegalDashboard: mockGetLegalDashboard }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))

function session(permissions: string[] = ["prevention:legal:export"]) {
  return {
    user: {
      id: "legal-user", email: "legal@chome.cl", permissions,
      roles: ["prevencionista_faena"], worksiteIds: ["ws-own"], isGlobal: false,
    },
  }
}

describe("GET /api/prevencion/requisitos-legales/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockCan.mockReturnValue(false)
    mockScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
    const requirement = {
      id: "req-1", code: "DS44-7", requirementVersion: 1, status: "published", sourceType: "law", authority: "Ministerio del Trabajo",
      sourceTitle: "DS 44", sourceReference: "=HYPERLINK(\"https://example.test\")", article: "7", requirement: "+Mantener MIPER",
      validFrom: "2025-02-01", validTo: null, topic: "MIPER", chomeRole: "Empleador", evidenceRequired: "Matriz publicada", frequency: "Anual",
      reviewedByUserId: "reviewer", approvedByUserId: "approver", publishedAt: "2026-07-01", publishedHashSha256: "legal-hash",
    }
    const applicability = {
      id: "app-1", processId: null, activityReference: "Operación", applicabilityStatus: "applicable", rationale: "Aplica por operación industrial",
      responsibleSnapshot: "Prevención", evidenceReference: "EVID-LEGAL", evidenceDueAt: "2026-08-01", complianceStatus: "noncompliant",
      assessedByUserId: "assessor", approvedByUserId: "approver", version: 2,
    }
    mockGetLegalDashboard.mockResolvedValue({
      requirements: [requirement],
      applicabilities: [{ requirement, applicability, worksiteName: "Faena Norte" }],
      assessments: [{ applicabilityId: "app-1", status: "noncompliant", finding: "Brecha documental", evidenceReference: "EVID-LEGAL", capaActionId: "capa-1", assessedByUserId: "assessor", assessedAt: "2026-07-02", nextAssessmentAt: "2026-08-01" }],
      gaps: [{ requirement, applicability, worksiteName: "Faena Norte" }],
    })
  })

  it("requires authentication and legal export permission", async () => {
    const { GET } = await import("./route")
    expect((await GET()).status).toBe(401)

    mockAuth.mockResolvedValue(session([]))
    expect((await GET()).status).toBe(403)
    expect(mockGetLegalDashboard).not.toHaveBeenCalled()
  })

  it("exports only the session scope with traceability, safe cells and audit", async () => {
    mockAuth.mockResolvedValue(session())
    mockCan.mockReturnValue(true)
    const { GET } = await import("./route")

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("spreadsheetml")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mockGetLegalDashboard).toHaveBeenCalledWith({
      userId: "legal-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:legal:export"],
    })

    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer())
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Requisitos", "Aplicabilidad", "Evaluaciones", "Brechas", "Metadatos",
    ])
    expect(workbook.getWorksheet("Requisitos")?.getCell("G2").value).toBe("'=HYPERLINK(\"https://example.test\")")
    expect(workbook.getWorksheet("Requisitos")?.getCell("I2").value).toBe("'+Mantener MIPER")
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "export", entityType: "prevention_legal_register" }))
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockScope = vi.hoisted(() => vi.fn())
const mockGetMiperVersion = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockScope }))
vi.mock("@/lib/services/miper/queries", () => ({ getMiperVersion: mockGetMiperVersion }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))

function session(permissions: string[] = ["prevention:risk:view"]) {
  return {
    user: {
      id: "risk-user",
      email: "riesgos@chome.cl",
      permissions,
      roles: ["prevencionista_faena"],
      worksiteIds: ["ws-own"],
      isGlobal: false,
    },
  }
}

/** Versión sellada v2 tal como la devuelve `getMiperVersion`. */
const detail = {
  version: {
    id: "version-2", matrixId: "matrix-1", versionNumber: 2, period: 2026, roundId: "round-1",
    snapshot: {
      header: {
        period: 2026, iperCode: "RE-04", elaboratedOn: "2026-01-15", updatedOn: "2026-02-01",
        companyName: "Biodiversa SpA", companyRut: "76.123.456-7", companyAddress: "Av. del Mar 100", companyCommune: "Santiago",
        economicActivity: "Servicios ambientales", adherentNumber: "AD-123", worksiteName: "Faena Norte",
        siteRepresentativeUserId: "u-rep", siteRepresentativeName: "Ana Representante",
        headcountTotal: 10, headcountMale: 6, headcountFemale: 3, headcountOther: 1,
        participationSummary: "Taller participativo", consultationEvidenceReference: "EVID-PAR-001",
      },
      entries: [{
        id: "entry-1", rowNumber: 1,
        activity: "Transporte", task: "Descarga", position: "Conductor", location: "Patio",
        exposedFemale: 1, exposedMale: 4, exposedOther: 0,
        riskFactorId: "rf-1", riskFactor: "+factor", isRoutine: true,
        hazard: "=WEBSERVICE(\"https://example.test\")", risk: "Volcamiento", probableDamage: "Politraumatismo",
        probability: 4, consequence: 4, magnitude: 16, classification: "intolerable", controlledStatus: "yes",
        controls: [{ id: "ctl-1", hierarchy: "engineering", description: "Topes de descarga", responsibleUserId: "u-1", responsibleName: "Supervisor", dueDate: "2026-06-30", status: "implemented" }],
      }],
    },
    snapshotSha256: "snapshot-hash-v2", changeSummary: "Emisión inicial",
    elaboratedByUserId: "u-elabora", technicalReviewerUserId: "u-revisa", approverUserId: "u-aprueba",
    elaboratedByName: "Elena Elabora", technicalReviewerName: "Revisora Técnica", approverName: "Alberto Aprueba",
    approvedAt: "2026-03-01",
  },
  worksiteId: "ws-own", worksiteName: "Faena Norte", worksiteCode: "BIO", methodologySnapshot: {},
  versions: [{ versionNumber: 2, approvedAt: "2026-03-01", changeSummary: "Emisión inicial", approverName: "Alberto Aprueba", elaboratedByName: "Elena Elabora" }],
}

describe("GET /api/prevencion/miper/[id]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockCan.mockReturnValue(false)
    mockScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
    mockGetMiperVersion.mockResolvedValue(detail as never)
  })

  it("requires authentication and view permission", async () => {
    const { GET } = await import("./route")
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "version-2" }) })).status).toBe(401)

    mockAuth.mockResolvedValue(session([]))
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "version-2" }) })).status).toBe(403)
    expect(mockGetMiperVersion).not.toHaveBeenCalled()
  })

  it("exports the scoped sealed version, neutralizes formulas and records audit", async () => {
    mockAuth.mockResolvedValue(session())
    mockCan.mockReturnValue(true)
    const { GET } = await import("./route")

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "version-2" }) })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("spreadsheetml")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-disposition")).toContain("RE-04-MIPER-BIO-2026-v2.xlsx")
    expect(mockGetMiperVersion).toHaveBeenCalledWith("version-2", {
      userId: "risk-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:risk:view"],
    })

    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer())
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "RE-04 IPER", "Modificaciones", "Criterios de Evaluación IPER", "Metadatos",
    ])
    expect(workbook.getWorksheet("RE-04 IPER")?.getCell("I14").value).toBe("'+factor")
    expect(workbook.getWorksheet("RE-04 IPER")?.getCell("K14").value).toBe("'=WEBSERVICE(\"https://example.test\")")
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "export", entityType: "prevention_risk_matrix_version", entityId: "version-2",
    }))
  })

  it("does not reveal whether an out-of-scope version exists", async () => {
    mockAuth.mockResolvedValue(session())
    mockCan.mockReturnValue(true)
    mockGetMiperVersion.mockRejectedValue(new Error("fuera de alcance"))
    const { GET } = await import("./route")

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "version-foreign" }) })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "MIPER no encontrada o fuera de alcance" })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})

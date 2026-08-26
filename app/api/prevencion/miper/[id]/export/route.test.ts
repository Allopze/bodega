import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockScope = vi.hoisted(() => vi.fn())
const mockGetPublishedRiskMatrix = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: mockScope }))
vi.mock("@/lib/services/prevention-risk-legal", () => ({ getPublishedRiskMatrix: mockGetPublishedRiskMatrix }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
// El exportador (lib/services/prevention-risk-export.ts) consulta historial de
// Modificaciones y CAPA de Programa de Trabajo directo por `db.select()` — un
// objeto encadenable "thenable" que siempre resuelve `[]` es suficiente: este
// test no ejercita esas dos hojas, sólo que no revienten al construirse vacías.
function emptyChain() {
  const chain: { from: () => typeof chain; where: () => typeof chain; orderBy: () => typeof chain; then: (resolve: (rows: unknown[]) => unknown) => Promise<unknown> } = {
    from: () => chain, where: () => chain, orderBy: () => chain,
    then: (resolve) => Promise.resolve([]).then(resolve),
  }
  return chain
}
vi.mock("@/db", () => ({ db: { select: vi.fn(() => emptyChain()) } }))

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

describe("GET /api/prevencion/miper/[id]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockCan.mockReturnValue(false)
    mockScope.mockReturnValue({ mode: "some", ids: ["ws-own"] })
    mockGetPublishedRiskMatrix.mockResolvedValue({
      worksiteName: "Faena Norte",
      matrix: {
        id: "matrix-1", worksiteId: "ws-own", matrixVersion: 2, status: "published",
        methodologySnapshot: { code: "ISP-v3" }, revisionReason: "Revisión anual",
        participationSummary: "Consulta paritaria documentada", consultationEvidenceReference: "DOC-1",
        reviewedByUserId: "reviewer", reviewedAt: "2026-07-01", approvedByUserId: "approver", approvedAt: "2026-07-02",
        publishedByUserId: "publisher", publishedAt: "2026-07-03", effectiveFrom: "2026-07-03", reviewDueAt: "2027-07-03",
        publishedHashSha256: "hash-miper-2",
      },
      entries: [{
        process: { name: "Proceso principal" }, task: { name: "Tarea crítica" }, position: { name: "Operador" },
        entry: {
          id: "entry-1", hazardCode: "PEL-01", hazard: "=WEBSERVICE(\"https://example.test\")", risk: "Caída de altura", riskFactor: "+factor",
          expectedEventOrDamage: "Lesión", exposedPeopleDescription: "Personal operativo", exposedPeopleCount: 3,
          isRoutine: true, specificWorkplace: null, exposedWorkersFemale: null, exposedWorkersMale: 3, exposedWorkersOther: null,
          probability: 2, consequence: 4, riskMagnitude: 8, riskClassification: "importante",
          controlStatusText: "partial", controlDeadlineText: "Mensual",
          genderConsiderations: "Exposición evaluada por sexo", sensitiveWorkerConsiderations: "Incluye personas especialmente sensibles",
          inherentDimensions: null, inherentLevel: null, residualDimensions: { probability: 2, consequence: 4 },
          residualLevel: "high", isCritical: true, responsibleSnapshot: "Jefatura", evidenceReference: "EVID-1", specialMethodologyReference: "TMERT",
        },
      }],
      controls: [{ riskEntryId: "entry-1", description: "Aislamiento", hierarchy: "engineering", isExisting: true, isCritical: true, performanceStandard: "100% operativo", verificationFrequency: "Mensual", responsibleSnapshot: "Supervisor", status: "implemented", effectivenessStatus: "verified_effective", evidenceReference: "CTRL-1" }],
      triggers: [{ triggerType: "annual", sourceType: "system", sourceId: "matrix-1", description: "Revisión anual", status: "open", dueAt: "2027-07-03", resolution: null, resolvedByUserId: null, resolvedAt: null }],
    })
  })

  it("requires authentication and view permission", async () => {
    const { GET } = await import("./route")
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "matrix-1" }) })).status).toBe(401)

    mockAuth.mockResolvedValue(session([]))
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "matrix-1" }) })).status).toBe(403)
    expect(mockGetPublishedRiskMatrix).not.toHaveBeenCalled()
  })

  it("exports the scoped published snapshot, neutralizes formulas and records audit", async () => {
    mockAuth.mockResolvedValue(session())
    mockCan.mockReturnValue(true)
    const { GET } = await import("./route")

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "matrix-1" }) })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("spreadsheetml")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mockGetPublishedRiskMatrix).toHaveBeenCalledWith("matrix-1", {
      userId: "risk-user", scope: { mode: "some", ids: ["ws-own"] }, permissions: ["prevention:risk:view"],
    })

    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer())
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "RE-04 IPER", "Controles", "Modificaciones", "Criterios de Evaluación IPER", "Programa de Trabajo", "Aprobación", "Revisiones", "Metadatos",
    ])
    // Columna K = PELIGRO en la hoja RE-04 IPER (A=N°,B=ACTIVIDAD,...,K=PELIGRO).
    expect(workbook.getWorksheet("RE-04 IPER")?.getCell("K2").value).toBe("'=WEBSERVICE(\"https://example.test\")")
    expect(workbook.getWorksheet("Aprobación")?.getCell("B15").value).toBe("hash-miper-2")
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "export", entityType: "prevention_risk_matrix", entityId: "matrix-1",
    }))
  })

  it("does not reveal whether an out-of-scope matrix exists", async () => {
    mockAuth.mockResolvedValue(session())
    mockCan.mockReturnValue(true)
    mockGetPublishedRiskMatrix.mockRejectedValue(new Error("fuera de alcance"))
    const { GET } = await import("./route")

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "matrix-foreign" }) })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "MIPER no encontrada o fuera de alcance" })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})

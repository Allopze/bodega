import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.hoisted(() => vi.fn())
const mockCan = vi.hoisted(() => vi.fn())
const mockGetCanonicalSafetyIndicatorYear = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/auth/can", () => ({ can: mockCan }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: vi.fn(() => ({ mode: "all", ids: [] })) }))
vi.mock("@/lib/services/prevention-indicadores", () => ({ getCanonicalSafetyIndicatorYear: mockGetCanonicalSafetyIndicatorYear }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

function result(month: number) {
  return {
    formulaVersion: "ds44-art73-2026-v3",
    year: 2026, startMonth: month, endMonth: month, status: "non_calculable",
    confirmed: { accidents: 0, injuredPeople: 0, absenceDays: 0, chargeDays: 0, accidentabilityRate: null, frequencyRate: null, severityRate: null },
    provisional: { accidents: 0, injuredPeople: 0, absenceDays: 0, chargeDays: 0, accidentabilityRate: null, frequencyRate: null, severityRate: null },
    workerAverage: null, workedHours: 0, denominatorSlots: 0, expectedDenominatorSlots: 1,
    pendingCaseCount: 0, errors: [], reconciliationIssues: ["Falta denominador"],
    incidentIds: [], personCaseKeys: [], denominatorIds: [], denominatorVersions: [],
    eventCounts: { incidents: 0, materialDamage: 0, environmentalDamage: 0 }, sexBreakdown: [],
    legacyComparison: { legacyId: null, status: "missing_legacy", legacy: null, derived: { trabajadores: 0, horasHombre: 0, accConTiempoPerdido: 0, diasPerdidos: 0, incidentes: 0, danoMaterial: 0, danoAmbiental: 0 }, differences: {} },
  }
}

describe("GET /api/prevencion/indicadores/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(null)
    mockCan.mockReturnValue(false)
    const months = Array.from({ length: 12 }, (_, index) => result(index + 1))
    mockGetCanonicalSafetyIndicatorYear.mockResolvedValue({
      year: 2026,
      groups: [{
        worksiteId: "ws-1", worksiteName: "Faena Norte", monthly: months,
        semesters: [{ ...result(1), startMonth: 1, endMonth: 6 }, { ...result(7), startMonth: 7, endMonth: 12 }],
        annual: { ...result(1), startMonth: 1, endMonth: 12 },
      }],
      denominators: [], closedPeriods: [], snapshots: [],
    })
  })

  it("requiere una sesión autenticada", async () => {
    const { GET } = await import("./route")
    const response = await GET(new NextRequest("http://localhost/api/prevencion/indicadores/export?year=2026"))
    expect(response.status).toBe(401)
  })

  it("requiere prevention:indicadores:view", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u-1", permissions: [] } })
    const { GET } = await import("./route")
    const response = await GET(new NextRequest("http://localhost/api/prevencion/indicadores/export?year=2026"))
    expect(response.status).toBe(403)
    expect(mockCan).toHaveBeenCalledWith(expect.anything(), "prevention:indicadores:view")
  })

  it("exporta el mismo motor canónico con fórmula, fuentes, no-calculable y conciliación", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u-1", email: "prevencion@chome.cl", permissions: ["prevention:indicadores:view"], isGlobal: true, worksiteIds: [] } })
    mockCan.mockReturnValue(true)
    const { GET } = await import("./route")
    const response = await GET(new NextRequest("http://localhost/api/prevencion/indicadores/export?year=2026"))
    expect(response.status).toBe(200)
    expect(response.headers.get("x-chome-data-status")).toBe("canonical-mixed")
    expect(response.headers.get("cache-control")).toBe("no-store")

    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer())
    expect(workbook.worksheets.map((item) => item.name)).toEqual(expect.arrayContaining([
      "Resultados mensuales", "Gravedad semestral", "Accidentabilidad anual", "Denominadores",
      "Fuentes numerador", "Conciliación legado", "Snapshots de cierre", "Metadatos",
    ]))
    const monthly = workbook.getWorksheet("Resultados mensuales")
    expect(monthly?.getCell("J2").value).toBe("No calculable")
    expect(String(monthly?.getCell("D2").value)).toContain("1.000.000")
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "export", entityType: "prevention_safety_indicators" }))
  })
})

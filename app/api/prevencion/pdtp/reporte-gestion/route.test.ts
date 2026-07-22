import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.hoisted(() => vi.fn())
const mockReport = vi.hoisted(() => vi.fn())
const mockResolveProgram = vi.hoisted(() => vi.fn())
const mockAudit = vi.hoisted(() => vi.fn())
const mockIsActiveWorksite = vi.hoisted(() => vi.fn(async () => true))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockAudit }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/services/prevention-pdtp", () => ({
  getPdtpManagementReport: mockReport,
  resolveActivePdtpProgramId: mockResolveProgram,
  isActivePdtpWorksite: mockIsActiveWorksite,
  assertWorksiteAccess: (worksiteId: string, scope: string[] | "all") => {
    if (scope !== "all" && !scope.includes(worksiteId)) throw new Error("Sin acceso")
  },
}))

import { GET } from "./route"

function session({
  permissions = ["prevention:pdtp:view"],
  worksiteIds = ["w1"],
  isGlobal = false,
  roleSlug = isGlobal ? "administrador" : "prevencionista_faena",
}: {
  permissions?: string[]
  worksiteIds?: string[]
  isGlobal?: boolean
  roleSlug?: string
} = {}) {
  return { user: { id: "u1", permissions, roles: [roleSlug], worksiteIds, isGlobal } }
}

function request(query = "") {
  return new NextRequest(`http://localhost/api/prevencion/pdtp/reporte-gestion${query}`)
}

const BASE_REPORT = {
  programId: "p1", programTitle: "Programa 2026", year: 2026, worksiteId: "w1", target: 0.9,
  objectives: [
    { objectiveOrder: 1, objective: "Liderazgo", activityCount: 5, planned: 10, executed: 8, percent: 0.8, meetsTarget: false, responsibles: ["PRF"] },
  ],
  indicatorDefinitions: [{ code: "avance_objetivo", label: "Avance por objetivo", formula: "ejecutado/planificado" }],
}

beforeEach(() => {
  vi.resetAllMocks()
  mockReport.mockResolvedValue(BASE_REPORT)
  mockResolveProgram.mockResolvedValue("p1")
  mockIsActiveWorksite.mockResolvedValue(true)
})

describe("GET PDTP reporte de gestión", () => {
  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
  })

  it("returns 403 without PDTP view permission", async () => {
    mockAuth.mockResolvedValue(session({ permissions: [] }))
    expect((await GET(request())).status).toBe(403)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it("returns 403 when the session has no worksite scope", async () => {
    mockAuth.mockResolvedValue(session({ worksiteIds: [] }))
    expect((await GET(request())).status).toBe(403)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it("requires an explicit worksite when a scoped user has several", async () => {
    mockAuth.mockResolvedValue(session({ worksiteIds: ["w1", "w2"] }))
    expect((await GET(request())).status).toBe(400)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it("returns 403 for a worksite outside the authorized scope", async () => {
    mockAuth.mockResolvedValue(session({ worksiteIds: ["w1"] }))
    expect((await GET(request("?faena=w-ajena"))).status).toBe(403)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it("derives the only authorized worksite, resolves the active program, and returns a signed Excel", async () => {
    mockAuth.mockResolvedValue(session())

    const response = await GET(request("?year=2026"))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-disposition")).toContain("pdtp-reporte-gestion-2026.xlsx")
    expect(mockResolveProgram).toHaveBeenCalledWith(2026)
    expect(mockReport).toHaveBeenCalledWith({ programId: "p1", worksiteId: "w1", scope: ["w1"], filters: {} })
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "export", entityType: "prevention_pdtp_program" }))

    // El Excel real generado por la ruta (no mockeado) debe reabrir sin errores.
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(await response.arrayBuffer())
    expect(reopened.worksheets.map((ws) => ws.name)).toEqual(expect.arrayContaining(["Resumen por objetivo", "Indicadores"]))
  })

  it("escapes objective/responsible text that looks like a formula so Excel never evaluates it", async () => {
    mockAuth.mockResolvedValue(session())
    mockReport.mockResolvedValue({
      ...BASE_REPORT,
      objectives: [{ ...BASE_REPORT.objectives[0], objective: "=SUM(A1:A10)", responsibles: ["+2+5"] }],
    })

    const response = await GET(request("?year=2026"))
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(await response.arrayBuffer())
    const summary = reopened.getWorksheet("Resumen por objetivo")!

    const objectiveCell = summary.getRow(2).getCell(2)
    const responsiblesCell = summary.getRow(2).getCell(8)
    expect(objectiveCell.type).not.toBe(ExcelJS.ValueType.Formula)
    expect(objectiveCell.value).toBe("'=SUM(A1:A10)")
    expect(responsiblesCell.type).not.toBe(ExcelJS.ValueType.Formula)
    expect(responsiblesCell.value).toBe("'+2+5")
  })

  it("parses cut filters from the query string", async () => {
    mockAuth.mockResolvedValue(session())
    await GET(request("?programId=p1&responsable=prf&objetivo=2&estado=deviates&desde=1&hasta=6"))

    expect(mockReport).toHaveBeenCalledWith({
      programId: "p1", worksiteId: "w1", scope: ["w1"],
      filters: { responsibleSlug: "prf", objectiveOrder: 2, status: "deviates", monthFrom: 1, monthTo: 6 },
    })
  })

  it("returns 404 when no active program can be resolved", async () => {
    mockAuth.mockResolvedValue(session())
    mockResolveProgram.mockResolvedValue(null)

    const response = await GET(request())
    expect(response.status).toBe(404)
    expect(mockReport).not.toHaveBeenCalled()
  })
})

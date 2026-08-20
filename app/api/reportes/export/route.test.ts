import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getReportData: vi.fn(),
  buildXlsxBuffer: vi.fn(),
  recordAudit: vi.fn(),
}))

vi.mock("@/lib/auth/auth", () => ({ auth: () => mocks.auth() }))
vi.mock("@/lib/reports/export", () => ({
  getReportData: (...args: unknown[]) => mocks.getReportData(...args),
  buildXlsxBuffer: (...args: unknown[]) => mocks.buildXlsxBuffer(...args),
}))
vi.mock("@/lib/audit", () => ({ recordAudit: (...args: unknown[]) => mocks.recordAudit(...args) }))

const { GET } = await import("./route")

function session(...permissions: string[]) {
  return { user: { id: "u-1", email: "quien@chome.cl", permissions } }
}

function request(tipo: string) {
  return new NextRequest(`http://localhost/api/reportes/export?tipo=${tipo}&from=2026-08-01&to=2026-08-31`)
}

describe("GET /api/reportes/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getReportData.mockResolvedValue({ filenameBase: "cobranza", worksheetName: "Cobranza", headers: [], rows: [[1], [2]] })
    mocks.buildXlsxBuffer.mockResolvedValue(Buffer.from("xlsx"))
    mocks.recordAudit.mockResolvedValue(undefined)
  })

  it("rechaza la cobranza a quien tiene billing:export pero no billing:view", async () => {
    mocks.auth.mockResolvedValue(session("billing:export"))

    const response = await GET(request("facturacion_cobranza"))

    expect(response.status).toBe(403)
    expect(mocks.getReportData).not.toHaveBeenCalled()
  })

  it("audita la exportación de cobranza, igual que su ruta gemela", async () => {
    mocks.auth.mockResolvedValue(session("billing:view", "billing:export"))

    const response = await GET(request("facturacion_cobranza"))

    expect(response.status).toBe(200)
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "export",
      entityType: "billing_cobranza",
      entityId: "export",
      newState: { filters: { fromDate: "2026-08-01", toDate: "2026-08-31" }, rows: 2 },
    }))
  })

  it("no exige auditoría a los reportes que el manifiesto no promete auditados", async () => {
    mocks.auth.mockResolvedValue(session("reports:view"))

    const response = await GET(request("gasto_faena"))

    expect(response.status).toBe(200)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it("no entrega un Libro de Compras vacío cuando falta el codEmp: responde 503 con la causa", async () => {
    const { DteCodEmpMissingError } = await import("@/lib/services/dte-portal/require-cod-emp")
    mocks.auth.mockResolvedValue(session("purchasing:view"))
    mocks.getReportData.mockRejectedValue(new DteCodEmpMissingError())

    const response = await GET(request("dte_libro_compras"))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toContain("no está configurada")
  })
})

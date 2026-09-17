import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockAuth = vi.hoisted(() => vi.fn())
const mockGetClosure = vi.hoisted(() => vi.fn())
const mockRenderRe36Buffer = vi.hoisted(() => vi.fn())
const mockAudit = vi.hoisted(() => vi.fn())
const mockBuildRe36Document = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/reports/pdtp-re36-workbook", () => ({ renderPdtpRe36Buffer: mockRenderRe36Buffer }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockAudit }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/services/pdtp/period-closures", () => ({ getPdtpPeriodClosure: mockGetClosure }))
// Si la ruta llegara a importar el constructor del documento vivo, este mock
// permite afirmar que NUNCA se llama: el cierre se renderiza desde la foto.
vi.mock("@/lib/services/pdtp/re36-document", () => ({ buildPdtpRe36Document: mockBuildRe36Document }))

import { GET } from "./route"

function session(permissions = ["prevention:pdtp:view"], worksiteIds = ["w1"], isGlobal = false) {
  return { user: { id: "u1", email: "u1@test.cl", permissions, roles: [isGlobal ? "administrador" : "prevencionista_faena"], worksiteIds, isGlobal } }
}

function request() {
  return new NextRequest("http://localhost/api/prevencion/pdtp/cierres/close-1/export")
}

const context = { params: Promise.resolve({ closureId: "close-1" }) }

function closure(overrides: Record<string, unknown> = {}) {
  return {
    id: "close-1",
    programId: "prog-1",
    worksiteId: "w1",
    year: 2026,
    month: 3,
    status: "closed",
    version: 2,
    digest: "f".repeat(64),
    closedAt: "2026-04-02T12:00:00.000Z",
    closeReason: "Mes revisado con la jefatura de faena.",
    reopenReason: null,
    driftedSinceClose: false,
    snapshotJson: {
      schemaVersion: 1,
      cutoff: { year: 2026, month: 3, asOf: "2026-03-31T23:59:59.999Z" },
      programVersion: { version: 4, contentDigest: "abc" },
      re36: {
        program: { id: "prog-1", year: 2026, version: 4, title: "Programa 2026" },
        worksite: { id: "w1", name: "Faena Uno", code: "F1" },
        sheets: [{ code: "pdtp_general" }],
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockGetClosure.mockResolvedValue(closure())
  mockRenderRe36Buffer.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
})

describe("GET export de un cierre PDTP", () => {
  it("devuelve 401 sin sesión", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(request(), context)).status).toBe(401)
  })

  it("devuelve 403 sin el permiso de ver el PDTP", async () => {
    mockAuth.mockResolvedValue(session([]))
    expect((await GET(request(), context)).status).toBe(403)
    expect(mockGetClosure).not.toHaveBeenCalled()
  })

  it("devuelve 403 cuando la faena del cierre está fuera del alcance", async () => {
    mockAuth.mockResolvedValue(session(["prevention:pdtp:view"], ["w9"]))
    mockGetClosure.mockRejectedValue(new Error("Sin acceso a la faena solicitada."))

    const response = await GET(request(), context)
    expect(response.status).toBe(403)
    expect(mockRenderRe36Buffer).not.toHaveBeenCalled()
  })

  it("devuelve 404 cuando el cierre no existe", async () => {
    mockAuth.mockResolvedValue(session())
    mockGetClosure.mockResolvedValue(null)
    expect((await GET(request(), context)).status).toBe(404)
  })

  it("renderiza desde el snapshot, nunca reconsultando el documento vivo", async () => {
    mockAuth.mockResolvedValue(session())

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    expect(mockBuildRe36Document).not.toHaveBeenCalled()
    const [document] = mockRenderRe36Buffer.mock.calls[0]!
    expect(document).toEqual(closure().snapshotJson.re36)
  })

  it("agrega la hoja 'Cierre' con corte, motivo, quién cerró y huella", async () => {
    mockAuth.mockResolvedValue(session())

    await GET(request(), context)

    const [, options] = mockRenderRe36Buffer.mock.calls[0]!
    const labels = options.closure.rows.map((row: { label: string }) => row.label)
    expect(labels).toContain("Mes cerrado")
    expect(labels).toContain("Fundamento del cierre")
    expect(labels).toContain("Huella de la foto (SHA-256)")
    const digestRow = options.closure.rows.find((row: { label: string }) => row.label === "Huella de la foto (SHA-256)")
    expect(digestRow.value).toBe("f".repeat(64))
    const monthRow = options.closure.rows.find((row: { label: string }) => row.label === "Mes cerrado")
    expect(monthRow.value).toBe("marzo de 2026")
  })

  it("nombra el archivo con año, mes, código de faena y versión del cierre", async () => {
    mockAuth.mockResolvedValue(session())

    const response = await GET(request(), context)

    expect(response.headers.get("content-disposition")).toContain("RE-36-PDTP-2026-03-F1-cierre-v2.xlsx")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "pdtp_period_closure",
      entityId: "close-1",
      newState: expect.objectContaining({ result: "success" }),
    }))
  })
})

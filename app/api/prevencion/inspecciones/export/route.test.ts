import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockBuild = vi.hoisted(() => vi.fn())
const mockXlsx = vi.hoisted(() => vi.fn())
const mockAssertEnabled = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/services/prevention-inspections-export", () => ({ buildInspectionExport: mockBuild }))
vi.mock("@/lib/services/prevention-inspections", () => ({ assertInspectionOperationEnabled: mockAssertEnabled }))
vi.mock("@/lib/reports/export", () => ({ buildXlsxBuffer: mockXlsx }))
vi.mock("@/lib/logger", () => ({
  logger: { error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { ModuleDisabledError } from "@/lib/services/module-toggles"
import { GET } from "./route"

const URL_BASE = "http://localhost/api/prevencion/inspecciones/export"

function session(permissions: string[]) {
  return { user: { id: "u1", permissions, roles: ["prevencionista_faena"], worksiteIds: ["w1"], isGlobal: false } }
}

const REPORT = {
  filenameBase: "inspecciones_filtradas_2026-10-19",
  worksheetName: "Inspecciones",
  headers: [],
  rows: [],
  filterSummary: { Estado: "Pendiente de revisión" },
}

beforeEach(() => {
  vi.resetAllMocks()
  mockAssertEnabled.mockResolvedValue(undefined)
  mockBuild.mockResolvedValue(REPORT)
  mockXlsx.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
})

describe("GET Excel de inspecciones", () => {
  it("responde 401 sin sesión", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(new Request(URL_BASE))).status).toBe(401)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("responde 403 sin permiso de exportar", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:view"]))
    expect((await GET(new Request(URL_BASE))).status).toBe(403)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("exporta con los filtros de la URL y pasa el contexto de trazabilidad al libro", async () => {
    const current = session(["prevention:inspections:export"])
    mockAuth.mockResolvedValue(current)

    const response = await GET(new Request(`${URL_BASE}?estado=completed&desde=2026-10-01&hasta=2026-10-19`))

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("spreadsheetml")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-disposition")).toContain("inspecciones_filtradas_2026-10-19.xlsx")
    expect(mockBuild).toHaveBeenCalledWith(
      { userId: "u1", scope: { mode: "some", ids: ["w1"] }, permissions: ["prevention:inspections:export"] },
      { status: "completed", executedFrom: "2026-10-01", executedTo: "2026-10-19" },
    )
    // REP-002: sin este segundo argumento el libro no lleva la hoja «Metadatos».
    expect(mockXlsx).toHaveBeenCalledWith(REPORT, {
      session: current,
      filters: { Estado: "Pendiente de revisión" },
      from: "01-10-2026",
      to: "19-10-2026",
    })
  })

  it("sin rango de fechas el contexto lo declara como «sin filtro»", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:export"]))
    await GET(new Request(URL_BASE))
    expect(mockXlsx).toHaveBeenCalledWith(REPORT, expect.objectContaining({ from: null, to: null }))
  })

  it("con el submódulo apagado responde 403 sin construir el libro ni ensuciar el log", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:export"]))
    mockAssertEnabled.mockRejectedValue(new ModuleDisabledError("prevention", "/prevencion/inspecciones"))

    const response = await GET(new Request(URL_BASE))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "El submódulo Inspecciones está desactivado." })
    expect(mockBuild).not.toHaveBeenCalled()
    expect(mockXlsx).not.toHaveBeenCalled()
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  it("cualquier otro error responde 500 y queda registrado", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:export"]))
    const failure = new Error("falló la consulta")
    mockBuild.mockRejectedValue(failure)

    const response = await GET(new Request(URL_BASE))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "No se pudo generar el Excel de inspecciones" })
    expect(mockLoggerError).toHaveBeenCalledWith("[prevencion/inspecciones/export]", failure)
  })
})

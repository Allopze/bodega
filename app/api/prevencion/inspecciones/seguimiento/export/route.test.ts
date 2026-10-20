import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockBuild = vi.hoisted(() => vi.fn())
const mockAssertEnabled = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/services/prevention-inspection-followup", () => ({ buildInspectionFollowupWorkbook: mockBuild }))
vi.mock("@/lib/services/prevention-inspections", () => ({ assertInspectionOperationEnabled: mockAssertEnabled }))
vi.mock("@/lib/logger", () => ({
  logger: { error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { ModuleDisabledError } from "@/lib/services/module-toggles"
import { GET } from "./route"

function session(permissions: string[]) {
  return { user: { id: "u1", permissions, roles: ["prevencionista_faena"], worksiteIds: ["w1"], isGlobal: false } }
}

/** La petición que Next entrega al handler; `query` es lo que lleva el enlace «Exportar Excel». */
function request(query = "") {
  return new Request(`http://localhost/api/prevencion/inspecciones/seguimiento/export${query}`)
}

beforeEach(() => {
  vi.resetAllMocks()
  mockAssertEnabled.mockResolvedValue(undefined)
  mockBuild.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
})

describe("GET Excel de seguimiento (Anexo 15)", () => {
  it("responde 401 sin sesión", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("responde 403 sin permiso de exportar", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:view"]))
    expect((await GET(request())).status).toBe(403)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it("exporta dentro del alcance de faenas de la sesión", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:export"]))

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("spreadsheetml")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-disposition")).toMatch(/anexo-15-seguimiento-\d{4}-\d{2}-\d{2}\.xlsx/)
    expect(mockBuild).toHaveBeenCalledWith({
      userId: "u1",
      scope: { mode: "some", ids: ["w1"] },
      permissions: ["prevention:inspections:export"],
    }, {})
  })

  it("sin filtros el archivo conserva su nombre de siempre", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:export"]))

    const response = await GET(request())

    expect(response.headers.get("content-disposition")).toMatch(/anexo-15-seguimiento-\d{4}-\d{2}-\d{2}\.xlsx/)
    expect(response.headers.get("content-disposition")).not.toContain("filtrado")
  })

  it("respeta los filtros del enlace: el libro se arma con ellos y el nombre lo declara", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:export"]))

    const response = await GET(request("?estado=vencidas&faena=w1&tipo=observation&q=%20extintor%20"))

    expect(response.status).toBe(200)
    expect(mockBuild).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" }),
      { status: "vencidas", worksiteId: "w1", kind: "observation", search: "extintor" },
    )
    // Un Excel filtrado no puede pasar por «el Anexo 15» completo.
    expect(response.headers.get("content-disposition")).toMatch(/anexo-15-seguimiento-\d{4}-\d{2}-\d{2}-filtrado\.xlsx/)
  })

  it("descarta los valores que no existen en vez de filtrar por ellos", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:export"]))

    const response = await GET(request("?estado=inventado&tipo=otro"))

    expect(mockBuild).toHaveBeenCalledWith(expect.anything(), {})
    expect(response.headers.get("content-disposition")).not.toContain("filtrado")
  })

  it("consulta el interruptor del submódulo antes de armar el libro", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:export"]))
    const order: string[] = []
    mockAssertEnabled.mockImplementation(async () => { order.push("toggle") })
    mockBuild.mockImplementation(async () => { order.push("build"); return new Uint8Array([1]).buffer })

    await GET(request())

    expect(order).toEqual(["toggle", "build"])
  })

  it("con el submódulo apagado responde 403 sin construir el libro ni ensuciar el log", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:export"]))
    mockAssertEnabled.mockRejectedValue(new ModuleDisabledError("prevention", "/prevencion/inspecciones"))

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "El submódulo Inspecciones está desactivado." })
    expect(mockBuild).not.toHaveBeenCalled()
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  it("cualquier otro error responde 500 y deja rastro en el log", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:export"]))
    const failure = new Error("falló la consulta")
    mockBuild.mockRejectedValue(failure)

    const response = await GET(request())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "No se pudo generar el seguimiento." })
    expect(mockLoggerError).toHaveBeenCalledWith("[prevencion/inspecciones/seguimiento/export]", failure)
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockPreview = vi.hoisted(() => vi.fn())
const mockAssertEnabled = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/services/prevention-inspections", () => ({ assertInspectionOperationEnabled: mockAssertEnabled }))
vi.mock("@/lib/services/prevention-inspections/template-preview", () => ({ getInspectionTemplatePreview: mockPreview }))
vi.mock("@/lib/logger", () => ({
  logger: { error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { ModuleDisabledError } from "@/lib/services/module-toggles"
import { GET } from "./route"

const URL_BASE = "http://localhost/api/prevencion/inspecciones/plantillas/t1/vista-previa"
const context = (templateId = "t1") => ({ params: Promise.resolve({ templateId }) })

function session(permissions: string[]) {
  return { user: { id: "u1", permissions, roles: ["prevencionista_faena"], worksiteIds: ["w1"], isGlobal: false } }
}

const PAYLOAD = { template: { id: "t1", name: "Inspección de Contenedores" }, versions: [], questionnaire: { sections: [] }, technical: {} }

beforeEach(() => {
  vi.resetAllMocks()
  mockAssertEnabled.mockResolvedValue(undefined)
  mockPreview.mockResolvedValue(PAYLOAD)
})

describe("GET vista previa de una plantilla", () => {
  it("responde 401 sin sesión y no consulta nada", async () => {
    mockAuth.mockResolvedValue(null)
    const response = await GET(new Request(URL_BASE), context())
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mockPreview).not.toHaveBeenCalled()
  })

  it("responde 403 sin permiso de ver inspecciones", async () => {
    mockAuth.mockResolvedValue(session(["prevention:capa:view"]))
    const response = await GET(new Request(URL_BASE), context())
    expect(response.status).toBe(403)
    expect(mockPreview).not.toHaveBeenCalled()
  })

  it("responde 404 si la plantilla no existe", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:view"]))
    mockPreview.mockResolvedValue(null)
    const response = await GET(new Request(URL_BASE), context("no-existe"))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Plantilla no encontrada." })
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mockPreview).toHaveBeenCalledWith("no-existe", expect.anything())
  })

  it("responde 200 con el cuestionario, sin caché, y pasa el acceso de quien pide", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:view"]))
    const response = await GET(new Request(URL_BASE), context())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual(PAYLOAD)
    expect(mockPreview).toHaveBeenCalledWith("t1", {
      userId: "u1",
      scope: { mode: "some", ids: ["w1"] },
      permissions: ["prevention:inspections:view"],
    })
  })

  it("con el submódulo apagado responde 403 sin leer la plantilla ni ensuciar el log", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:view"]))
    mockAssertEnabled.mockRejectedValue(new ModuleDisabledError("prevention", "/prevencion/inspecciones"))
    const response = await GET(new Request(URL_BASE), context())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "El submódulo Inspecciones está desactivado." })
    expect(mockPreview).not.toHaveBeenCalled()
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  it("cualquier otro error responde 500 y queda registrado", async () => {
    mockAuth.mockResolvedValue(session(["prevention:inspections:view"]))
    const failure = new Error("falló la consulta")
    mockPreview.mockRejectedValue(failure)
    const response = await GET(new Request(URL_BASE), context())
    expect(response.status).toBe(500)
    expect(mockLoggerError).toHaveBeenCalledWith("[prevencion/inspecciones/plantillas/vista-previa]", failure)
  })
})

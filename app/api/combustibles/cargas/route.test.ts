import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockHeaders = vi.hoisted(() => vi.fn())
const mockIsRouteOperational = vi.hoisted(() => vi.fn())
const mockConsumeFixedWindowLimit = vi.hoisted(() => vi.fn())
const mockCreateInternalFieldLoad = vi.hoisted(() => vi.fn())
const mockParseRequest = vi.hoisted(() => vi.fn())

vi.mock("next/headers", () => ({ headers: mockHeaders }))
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: mockIsRouteOperational }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: mockConsumeFixedWindowLimit }))
vi.mock("@/lib/services/fuel-tae", () => ({ createInternalFieldLoad: mockCreateInternalFieldLoad }))
vi.mock("@/lib/services/fuel-tae/request", () => ({ parseFieldLoadRequest: mockParseRequest }))

const { TaeSubmissionRejected } = await import("@/lib/services/fuel-tae/errors")
const { POST } = await import("./route")

function session(overrides: { permissions?: string[]; isGlobal?: boolean; worksiteIds?: string[] } = {}) {
  return {
    user: {
      id: "user-1",
      permissions: overrides.permissions ?? ["combustibles:register_load"],
      isGlobal: overrides.isGlobal ?? false,
      worksiteIds: overrides.worksiteIds ?? ["ws-1"],
      roles: [],
    },
  }
}

function request() {
  return { formData: () => Promise.resolve(new FormData()) } as unknown as Request
}

describe("POST /api/combustibles/cargas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHeaders.mockResolvedValue({ get: () => null })
    mockIsRouteOperational.mockResolvedValue(true)
    mockConsumeFixedWindowLimit.mockResolvedValue({ allowed: true })
    mockParseRequest.mockResolvedValue({ ok: true, input: { worksiteId: "ws-1" }, evidence: [], ocrResult: undefined })
    mockCreateInternalFieldLoad.mockResolvedValue({ id: "load-1", publicResultToken: "tok", duplicate: false })
  })

  it("401 sin sesión", async () => {
    mockAuth.mockResolvedValue(null)
    const response = await POST(request())
    expect(response.status).toBe(401)
    expect(mockCreateInternalFieldLoad).not.toHaveBeenCalled()
  })

  it("403 sin el permiso register_load, llamando a la API directamente", async () => {
    mockAuth.mockResolvedValue(session({ permissions: ["combustibles:view", "combustibles:tae_view"] }))
    const response = await POST(request())
    expect(response.status).toBe(403)
    // Ni siquiera se lee el cuerpo: el permiso se decide antes de tocar nada.
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockCreateInternalFieldLoad).not.toHaveBeenCalled()
  })

  it("403 si la faena elegida está fuera del alcance del usuario", async () => {
    mockAuth.mockResolvedValue(session({ worksiteIds: ["ws-otra"] }))
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(mockCreateInternalFieldLoad).not.toHaveBeenCalled()
  })

  it("201 registra la carga con el usuario de la sesión", async () => {
    mockAuth.mockResolvedValue(session())
    const response = await POST(request())
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ ok: true, data: { id: "load-1" } })
    expect(mockCreateInternalFieldLoad).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }))
  })

  it("un usuario global puede registrar en cualquier faena", async () => {
    mockAuth.mockResolvedValue(session({ isGlobal: true, worksiteIds: [] }))
    expect((await POST(request())).status).toBe(201)
  })

  it("200 al reenviar una carga ya registrada (idempotencia)", async () => {
    mockAuth.mockResolvedValue(session())
    mockCreateInternalFieldLoad.mockResolvedValue({ id: "load-1", publicResultToken: "tok", duplicate: true })
    expect((await POST(request())).status).toBe(200)
  })

  it("422 con el motivo cuando el servicio rechaza por regla de negocio", async () => {
    mockAuth.mockResolvedValue(session())
    mockCreateInternalFieldLoad.mockRejectedValue(new TaeSubmissionRejected("Los 500 L superan la capacidad del estanque.", "over_capacity", "liters"))
    const response = await POST(request())
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ ok: false, code: "over_capacity", field: "liters" })
  })

  it("400 con el detalle cuando el cuerpo no es válido", async () => {
    mockAuth.mockResolvedValue(session())
    mockParseRequest.mockResolvedValue({ ok: false, status: 400, body: { ok: false, message: "Datos del formulario inválidos" } })
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(mockCreateInternalFieldLoad).not.toHaveBeenCalled()
  })
})

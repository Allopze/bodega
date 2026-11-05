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
vi.mock("@/lib/services/fuel-tae/request", () => ({ parseInternalFieldLoadRequest: mockParseRequest }))

const { TaeSubmissionRejected } = await import("@/lib/services/fuel-tae/errors")
const { PastLoadNotAllowed, PossibleDuplicateLoad } = await import("@/lib/combustibles/field-load-rules")
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

  describe("carga de otro día y posible duplicada (vía interna)", () => {
    const PAST = { loadedAt: "2026-10-12T14:30", reason: "Se anotó en papel y no se ingresó" }

    it("403 si trae pastLoad y el usuario no tiene register_past_load: el servicio ni se llama", async () => {
      mockAuth.mockResolvedValue(session({ permissions: ["combustibles:register_load"] }))
      mockParseRequest.mockResolvedValue({ ok: true, input: { worksiteId: "ws-1", pastLoad: PAST }, evidence: [], ocrResult: undefined })
      const response = await POST(request())
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ ok: false, message: "No tienes permiso para registrar cargas con fecha pasada." })
      expect(mockCreateInternalFieldLoad).not.toHaveBeenCalled()
    })

    it("201 con register_past_load: pasa pastLoad y le dice al servicio que la fecha está permitida", async () => {
      mockAuth.mockResolvedValue(session({ permissions: ["combustibles:register_load", "combustibles:register_past_load"] }))
      mockParseRequest.mockResolvedValue({ ok: true, input: { worksiteId: "ws-1", pastLoad: PAST }, evidence: [], ocrResult: undefined })
      const response = await POST(request())
      expect(response.status).toBe(201)
      expect(mockCreateInternalFieldLoad).toHaveBeenCalledWith(expect.objectContaining({
        userId: "user-1",
        allowPastLoad: true,
        input: expect.objectContaining({ pastLoad: PAST }),
      }))
    })

    it("una carga de hoy no necesita el permiso y el servicio recibe allowPastLoad en falso", async () => {
      mockAuth.mockResolvedValue(session({ permissions: ["combustibles:register_load"] }))
      const response = await POST(request())
      expect(response.status).toBe(201)
      expect(mockCreateInternalFieldLoad).toHaveBeenCalledWith(expect.objectContaining({ allowPastLoad: false }))
    })

    it("el servicio es la última barrera: si rechaza la fecha pasada, responde 403", async () => {
      mockAuth.mockResolvedValue(session({ permissions: ["combustibles:register_load", "combustibles:register_past_load"] }))
      mockParseRequest.mockResolvedValue({ ok: true, input: { worksiteId: "ws-1", pastLoad: PAST }, evidence: [], ocrResult: undefined })
      mockCreateInternalFieldLoad.mockRejectedValue(new PastLoadNotAllowed())
      expect((await POST(request())).status).toBe(403)
    })

    it("422 possible_duplicate trae la otra carga para mostrarla", async () => {
      mockAuth.mockResolvedValue(session({ permissions: ["combustibles:register_load", "combustibles:register_past_load"] }))
      const other = { id: "sub-9", loadedAt: "2026-10-12T17:25:00.000Z", liters: 120, equipment: "CA-14", href: "/combustibles/cargas/terreno/sub-9" }
      mockCreateInternalFieldLoad.mockRejectedValue(new PossibleDuplicateLoad(other))
      const response = await POST(request())
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ ok: false, code: "possible_duplicate", duplicateOf: other })
    })

    it("acknowledgeDuplicate viaja hasta el servicio para registrar igual", async () => {
      mockAuth.mockResolvedValue(session())
      mockParseRequest.mockResolvedValue({ ok: true, input: { worksiteId: "ws-1", acknowledgeDuplicate: true }, evidence: [], ocrResult: undefined })
      await POST(request())
      expect(mockCreateInternalFieldLoad).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ acknowledgeDuplicate: true }) }))
    })

    it("la respuesta incluye cómo quedó la carga en el control", async () => {
      mockAuth.mockResolvedValue(session())
      const review = { loadId: "load-1", status: "flagged", flagReasons: ["late_entry"] }
      mockCreateInternalFieldLoad.mockResolvedValue({ id: "sub-1", publicResultToken: "tok", duplicate: false, review })
      expect(await (await POST(request())).json()).toMatchObject({ ok: true, data: { id: "sub-1", review } })
    })
  })

  describe("D3: offline/capturedAt no fecha la carga sin permiso ni motivo", () => {
    const CAPTURED = "2026-10-20T08:00:00.000Z"
    const PAST = { loadedAt: "2026-10-20T08:00", reason: "Se registró sin señal en la faena" }

    it("403 si viene offline:true sin register_past_load, aunque no traiga pastLoad", async () => {
      // El bypass del hallazgo 5.2: `register_load` + `offline` fechaba la carga
      // hasta 30 días atrás sin motivo ni marca de carga pasada.
      mockAuth.mockResolvedValue(session({ permissions: ["combustibles:register_load"] }))
      mockParseRequest.mockResolvedValue({ ok: true, input: { worksiteId: "ws-1", offline: true, capturedAt: CAPTURED }, evidence: [], ocrResult: undefined })
      const response = await POST(request())
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ ok: false, message: "No tienes permiso para registrar cargas con fecha pasada." })
      expect(mockCreateInternalFieldLoad).not.toHaveBeenCalled()
    })

    it("403 si sólo viene capturedAt (offline ausente) y falta el permiso", async () => {
      mockAuth.mockResolvedValue(session({ permissions: ["combustibles:register_load"] }))
      mockParseRequest.mockResolvedValue({ ok: true, input: { worksiteId: "ws-1", capturedAt: CAPTURED }, evidence: [], ocrResult: undefined })
      expect((await POST(request())).status).toBe(403)
      expect(mockCreateInternalFieldLoad).not.toHaveBeenCalled()
    })

    it("422 con register_past_load si el reenvío offline no se presenta como carga de otro día", async () => {
      mockAuth.mockResolvedValue(session({ permissions: ["combustibles:register_load", "combustibles:register_past_load"] }))
      mockParseRequest.mockResolvedValue({ ok: true, input: { worksiteId: "ws-1", offline: true, capturedAt: CAPTURED }, evidence: [], ocrResult: undefined })
      const response = await POST(request())
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ ok: false, code: "past_load_required", field: "pastLoad" })
      expect(mockCreateInternalFieldLoad).not.toHaveBeenCalled()
    })

    it("422 si el pastLoad no trae motivo (aunque el permiso esté)", async () => {
      mockAuth.mockResolvedValue(session({ permissions: ["combustibles:register_load", "combustibles:register_past_load"] }))
      mockParseRequest.mockResolvedValue({ ok: true, input: { worksiteId: "ws-1", offline: true, capturedAt: CAPTURED, pastLoad: { loadedAt: "2026-10-20T08:00", reason: "   " } }, evidence: [], ocrResult: undefined })
      const response = await POST(request())
      expect(response.status).toBe(422)
      expect(mockCreateInternalFieldLoad).not.toHaveBeenCalled()
    })

    it("201 con offline + pastLoad + register_past_load: llega al servicio como carga de otro día", async () => {
      // El servicio es quien escribe la auditoría con `Carga de otro día: <motivo>`
      // (`lib/services/fuel-tae/submit.ts`), por eso acá se comprueba que el motivo
      // viaje intacto hasta él; la fila de auditoría la cubre la prueba PGlite del
      // servicio (`fuel-past-load-pglite.test.ts`).
      mockAuth.mockResolvedValue(session({ permissions: ["combustibles:register_load", "combustibles:register_past_load"] }))
      mockParseRequest.mockResolvedValue({ ok: true, input: { worksiteId: "ws-1", offline: true, capturedAt: CAPTURED, pastLoad: PAST }, evidence: [], ocrResult: undefined })
      const response = await POST(request())
      expect(response.status).toBe(201)
      expect(mockCreateInternalFieldLoad).toHaveBeenCalledWith(expect.objectContaining({
        userId: "user-1",
        allowPastLoad: true,
        input: expect.objectContaining({ offline: true, capturedAt: CAPTURED, pastLoad: PAST }),
      }))
    })
  })
})

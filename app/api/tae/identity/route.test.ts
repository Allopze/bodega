import { describe, it, expect, vi, beforeEach } from "vitest"

const mockConsumeFixedWindowLimit = vi.hoisted(() => vi.fn())
const mockValidateRut = vi.hoisted(() => vi.fn())
const mockFindTaeWorkerByRut = vi.hoisted(() => vi.fn())
const mockGetTaeLinkWorksiteId = vi.hoisted(() => vi.fn())
const mockHeaders = vi.hoisted(() => vi.fn())
const mockIsRouteOperational = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/rate-limit", () => ({
  consumeFixedWindowLimit: mockConsumeFixedWindowLimit,
}))
vi.mock("@/lib/rut", () => ({ validateRut: mockValidateRut }))
vi.mock("@/lib/services/fuel-tae", () => ({
  findTaeWorkerByRut: mockFindTaeWorkerByRut,
  getTaeLinkWorksiteId: mockGetTaeLinkWorksiteId,
}))
vi.mock("next/headers", () => ({ headers: mockHeaders }))
vi.mock("@/lib/services/module-toggles", () => ({
  isRouteOperational: mockIsRouteOperational,
}))

function makeRequest(body: unknown): Request {
  return { json: () => Promise.resolve(body) } as unknown as Request
}

/**
 * Sección 19 — "Enumeración de tokens y RUT" y "Rate limiting detrás de NAT
 * compartido": /api/tae/identity es la superficie pública que busca un
 * trabajador por RUT dentro de la faena del enlace TAE.
 */
describe("POST /api/tae/identity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHeaders.mockResolvedValue(new Map([["cf-connecting-ip", "10.0.0.1"]]))
    mockConsumeFixedWindowLimit.mockResolvedValue({ allowed: true, remaining: 29 })
    mockValidateRut.mockReturnValue(true)
    mockGetTaeLinkWorksiteId.mockResolvedValue("ws-1")
    mockIsRouteOperational.mockResolvedValue(true)
  })

  it("detiene el endpoint público antes de consultar identidad si TAE está inactivo", async () => {
    mockIsRouteOperational.mockResolvedValue(false)
    const { POST } = await import("./route")

    const response = await POST(makeRequest({ accessToken: "token", rut: "11111111-1" }))

    expect(response.status).toBe(503)
    expect(mockConsumeFixedWindowLimit).not.toHaveBeenCalled()
    expect(mockGetTaeLinkWorksiteId).not.toHaveBeenCalled()
  })

  it("bloquea con 429 cuando la cuota ya está agotada, sin consultar nada más", async () => {
    mockConsumeFixedWindowLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 })
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ accessToken: "t", rut: "11111111-1" }))
    expect(res.status).toBe(429)
    expect(mockGetTaeLinkWorksiteId).not.toHaveBeenCalled()
  })

  it("rechaza un RUT con formato inválido con 400, sin gastar cuota", async () => {
    mockValidateRut.mockReturnValueOnce(false)
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ accessToken: "t", rut: "no-es-un-rut" }))
    expect(res.status).toBe(400)
    expect(mockConsumeFixedWindowLimit).not.toHaveBeenCalled()
  })

  it("busca el RUT sólo dentro de la faena del enlace (findTaeWorkerByRut acotado), nunca en todas las faenas", async () => {
    mockFindTaeWorkerByRut.mockResolvedValueOnce({ id: "w-1", firstName: "Ana", lastName: "Pérez" })
    const { POST } = await import("./route")
    await POST(makeRequest({ accessToken: "t", rut: "11111111-1" }))
    expect(mockFindTaeWorkerByRut).toHaveBeenCalledWith("11111111-1", "ws-1")
  })

  it("con un trabajador encontrado, no filtra RUT ni cargo — sólo nombre e inicial de apellido", async () => {
    mockFindTaeWorkerByRut.mockResolvedValueOnce({ id: "w-1", firstName: "Ana", lastName: "Pérez" })
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ accessToken: "t", rut: "11111111-1" }))
    const body = await res.json()
    expect(body.data).toEqual({ id: "w-1", name: "Ana P." })
    expect(JSON.stringify(body)).not.toContain("11111111")
  })

  /*
   * COM-003 (auditoría 2026-09-14). La versión anterior de esta prueba se
   * llamaba "un token inválido penaliza el rate limit igual que un RUT no
   * encontrado, SIN FILTRAR CUÁL FALLÓ" y sólo comparaba el código 404: los
   * cuerpos eran distintos ("No se encontró ningún trabajador activo con este
   * RUT en esta faena" contra "El enlace TAE no está disponible"), así que sí
   * filtraba cuál había fallado. Ahora se comparan los cuerpos completos.
   */
  it("COM-003: el RUT ausente y el enlace inválido devuelven exactamente la misma respuesta", async () => {
    const { POST } = await import("./route")

    mockFindTaeWorkerByRut.mockResolvedValueOnce(null)
    const rutAusente = await POST(makeRequest({ accessToken: "t", rut: "11111111-1" }))
    const cuerpoRutAusente = await rutAusente.json()

    mockGetTaeLinkWorksiteId.mockRejectedValueOnce(new Error("Este enlace TAE no está disponible"))
    const enlaceInvalido = await POST(makeRequest({ accessToken: "manipulado", rut: "11111111-1" }))
    const cuerpoEnlaceInvalido = await enlaceInvalido.json()

    expect(enlaceInvalido.status).toBe(rutAusente.status)
    expect(cuerpoEnlaceInvalido).toEqual(cuerpoRutAusente)
    // El texto tampoco puede nombrar la faena: era justo lo que confirmaba la
    // pertenencia de la persona.
    expect(JSON.stringify(cuerpoRutAusente)).not.toContain("faena")
  })

  /*
   * COM-003: el defecto principal. `recordFailure` sólo se llamaba en la rama
   * "no encontrado", de modo que confirmar RUT existentes era gratis e
   * ilimitado; el techo de 10 sólo castigaba los errores de la lista. Ahora la
   * cuota se consume antes de saber el resultado.
   */
  it("COM-003: acertar el RUT consume la misma cuota que fallarlo", async () => {
    const { POST } = await import("./route")

    mockFindTaeWorkerByRut.mockResolvedValueOnce({ id: "w-1", firstName: "Ana", lastName: "Pérez" })
    await POST(makeRequest({ accessToken: "t", rut: "11111111-1" }))
    const consumosTrasAcierto = mockConsumeFixedWindowLimit.mock.calls.length

    mockFindTaeWorkerByRut.mockResolvedValueOnce(null)
    await POST(makeRequest({ accessToken: "t", rut: "22222222-2" }))

    expect(consumosTrasAcierto).toBe(1)
    expect(mockConsumeFixedWindowLimit).toHaveBeenCalledTimes(2)
    for (const [key] of mockConsumeFixedWindowLimit.mock.calls) {
      expect(key).toContain("tae:identity:")
    }
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCheckRateLimit = vi.hoisted(() => vi.fn())
const mockRecordFailure = vi.hoisted(() => vi.fn())
const mockRecordSuccessForTelemetry = vi.hoisted(() => vi.fn())
const mockValidateRut = vi.hoisted(() => vi.fn())
const mockFindTaeWorkerByRut = vi.hoisted(() => vi.fn())
const mockGetTaeLinkWorksiteId = vi.hoisted(() => vi.fn())
const mockHeaders = vi.hoisted(() => vi.fn())
const mockIsRouteOperational = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  recordFailure: mockRecordFailure,
  recordSuccessForTelemetry: mockRecordSuccessForTelemetry,
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
    mockHeaders.mockResolvedValue(new Map([["x-forwarded-for", "10.0.0.1"]]))
    mockCheckRateLimit.mockResolvedValue({ allowed: true, waitTimeRemainingMs: 0 })
    mockValidateRut.mockReturnValue(true)
    mockGetTaeLinkWorksiteId.mockResolvedValue("ws-1")
    mockIsRouteOperational.mockResolvedValue(true)
  })

  it("detiene el endpoint público antes de consultar identidad si TAE está inactivo", async () => {
    mockIsRouteOperational.mockResolvedValue(false)
    const { POST } = await import("./route")

    const response = await POST(makeRequest({ accessToken: "token", rut: "11111111-1" }))

    expect(response.status).toBe(503)
    expect(mockCheckRateLimit).not.toHaveBeenCalled()
    expect(mockGetTaeLinkWorksiteId).not.toHaveBeenCalled()
  })

  it("bloquea con 429 cuando el rate limit ya está activo, sin consultar nada más", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, waitTimeRemainingMs: 60_000 })
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ accessToken: "t", rut: "11111111-1" }))
    expect(res.status).toBe(429)
    expect(mockGetTaeLinkWorksiteId).not.toHaveBeenCalled()
  })

  it("rechaza un RUT con formato inválido con 400, sin penalizar el rate limit", async () => {
    mockValidateRut.mockReturnValueOnce(false)
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ accessToken: "t", rut: "no-es-un-rut" }))
    expect(res.status).toBe(400)
    expect(mockRecordFailure).not.toHaveBeenCalled()
  })

  it("penaliza el rate limit con el umbral generoso de NAT compartido (10, no el default de 5) cuando el RUT no aparece en la faena", async () => {
    mockFindTaeWorkerByRut.mockResolvedValueOnce(null)
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ accessToken: "t", rut: "11111111-1" }))
    expect(res.status).toBe(404)
    expect(mockRecordFailure).toHaveBeenCalledWith(expect.stringContaining("tae:identity:"), { maxAttempts: 10 })
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
    expect(mockRecordFailure).not.toHaveBeenCalled()
    expect(mockRecordSuccessForTelemetry).toHaveBeenCalled()
  })

  it("un token inválido penaliza el rate limit igual que un RUT no encontrado, sin filtrar cuál falló", async () => {
    mockGetTaeLinkWorksiteId.mockRejectedValueOnce(new Error("Este enlace TAE no está disponible"))
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ accessToken: "manipulado", rut: "11111111-1" }))
    expect(res.status).toBe(404)
    expect(mockRecordFailure).toHaveBeenCalledWith(expect.stringContaining("tae:identity:"), { maxAttempts: 10 })
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  cronRequestSource: vi.fn(() => null),
  parseCronAllowedSources: vi.fn(() => []),
  verifyCronRequest: vi.fn(() => true),
  verifyCronInternalRequest: vi.fn(() => false),
  isRouteOperational: vi.fn(),
  syncVisionLinkHourly: vi.fn(),
  loadVisionLinkConfig: vi.fn(),
  withCronLock: vi.fn(async (_job: string, run: () => Promise<unknown>) => run()),
  consumeFixedWindowLimit: vi.fn(async () => ({ allowed: true, remaining: 9 })),
}))

vi.mock("@/lib/security/cron-auth", () => ({
  cronRequestSource: (...args: unknown[]) => Reflect.apply(mocks.cronRequestSource, null, args),
  parseCronAllowedSources: (...args: unknown[]) => Reflect.apply(mocks.parseCronAllowedSources, null, args),
  verifyCronRequest: (...args: unknown[]) => Reflect.apply(mocks.verifyCronRequest, null, args),
  verifyCronInternalRequest: (...args: unknown[]) => Reflect.apply(mocks.verifyCronInternalRequest, null, args),
}))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: (...args: unknown[]) => Reflect.apply(mocks.isRouteOperational, null, args) }))
vi.mock("@/lib/integrations/visionlink/visionlink-hourly-sync", () => ({ syncVisionLinkHourly: (...args: unknown[]) => Reflect.apply(mocks.syncVisionLinkHourly, null, args) }))
vi.mock("@/lib/integrations/visionlink/visionlink-settings", () => ({ loadVisionLinkConfig: (...args: unknown[]) => Reflect.apply(mocks.loadVisionLinkConfig, null, args) }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: [string, () => Promise<unknown>]) => Reflect.apply(mocks.withCronLock, null, args) }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: (...args: unknown[]) => Reflect.apply(mocks.consumeFixedWindowLimit, null, args) }))

const { GET } = await import("./route")
const { VisionLinkClientError } = await import("@/lib/integrations/visionlink/visionlink-client")

function request() {
  return new NextRequest("http://localhost/api/cron/fuel-visionlink-hourly", { headers: { authorization: "Bearer cron-secret" } })
}

const CONFIG = { clientId: "id", clientSecret: "secret", scope: "", syncEnabled: true, hasCredentials: true }
const RESULT = { from: "2026-11-19", to: "2026-11-20", vehicles: 6, segments: 300, hoursWritten: 90, failedVehicles: [] }

describe("GET /api/cron/fuel-visionlink-hourly", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret"
    vi.clearAllMocks()
    mocks.verifyCronRequest.mockReturnValue(true)
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.loadVisionLinkConfig.mockResolvedValue(CONFIG)
    mocks.withCronLock.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run())
    mocks.syncVisionLinkHourly.mockResolvedValue(RESULT)
  })

  it("rechaza una petición sin autorización", async () => {
    mocks.verifyCronRequest.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(mocks.syncVisionLinkHourly).not.toHaveBeenCalled()
  })

  it("respeta el interruptor del submódulo de control (el mismo de la corrida diaria)", async () => {
    mocks.isRouteOperational.mockResolvedValue(false)
    expect(await (await GET(request())).json()).toMatchObject({ outcome: "disabled" })
    expect(mocks.isRouteOperational).toHaveBeenCalledWith("/combustibles/fuentes")
    expect(mocks.syncVisionLinkHourly).not.toHaveBeenCalled()
  })

  it("informa deshabilitado —no falla— sin credenciales o con el sync apagado", async () => {
    mocks.loadVisionLinkConfig.mockResolvedValue({ ...CONFIG, clientSecret: "", hasCredentials: false })
    expect(await (await GET(request())).json()).toMatchObject({ outcome: "disabled", reason: "sin credenciales" })
    mocks.loadVisionLinkConfig.mockResolvedValue({ ...CONFIG, syncEnabled: false })
    expect(await (await GET(request())).json()).toMatchObject({ outcome: "disabled", reason: "sync deshabilitado" })
    expect(mocks.syncVisionLinkHourly).not.toHaveBeenCalled()
  })

  it("sincroniza ayer y hoy con su propio candado y devuelve el resumen", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "success", code: "FUEL_CRON_SUCCESS", segments: 300, hoursWritten: 90 })
    expect(mocks.withCronLock).toHaveBeenCalledWith("fuel-visionlink-hourly", expect.any(Function))
    expect(mocks.syncVisionLinkHourly).toHaveBeenCalledWith(CONFIG, { lookbackDays: 2 })
  })

  it("informa conflicto cuando otra corrida tiene el candado", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true })
    expect((await GET(request())).status).toBe(409)
  })

  it("responde 429 cuando se agotó la cuota de llamadas", async () => {
    mocks.consumeFixedWindowLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 })
    expect((await GET(request())).status).toBe(429)
    expect(mocks.syncVisionLinkHourly).not.toHaveBeenCalled()
  })

  it("un equipo que falla vuelve la corrida parcial, con el detalle", async () => {
    mocks.syncVisionLinkHourly.mockResolvedValue({ ...RESULT, failedVehicles: [{ vehicleCode: "CR-51", errorCode: "VISIONLINK_HTTP_ERROR" }] })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "partial", failedVehicles: [{ vehicleCode: "CR-51", errorCode: "VISIONLINK_HTTP_ERROR" }] })
  })

  it("falla con el código del cliente y sin detalles del proveedor", async () => {
    mocks.syncVisionLinkHourly.mockRejectedValue(new VisionLinkClientError("VISIONLINK_AUTH_FAILED", 401))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual(expect.objectContaining({ outcome: "failed", errorCode: "VISIONLINK_AUTH_FAILED" }))
  })
})

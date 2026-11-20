import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  cronRequestSource: vi.fn(() => null),
  parseCronAllowedSources: vi.fn(() => []),
  verifyCronRequest: vi.fn(() => true),
  verifyCronInternalRequest: vi.fn(() => false),
  isRouteOperational: vi.fn(),
  syncVisionLink: vi.fn(),
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
vi.mock("@/lib/integrations/visionlink/visionlink-sync", () => ({ syncVisionLink: (...args: unknown[]) => Reflect.apply(mocks.syncVisionLink, null, args) }))
vi.mock("@/lib/integrations/visionlink/visionlink-hourly-sync", () => ({ syncVisionLinkHourly: (...args: unknown[]) => Reflect.apply(mocks.syncVisionLinkHourly, null, args) }))
vi.mock("@/lib/integrations/visionlink/visionlink-settings", () => ({ loadVisionLinkConfig: (...args: unknown[]) => Reflect.apply(mocks.loadVisionLinkConfig, null, args) }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: [string, () => Promise<unknown>]) => Reflect.apply(mocks.withCronLock, null, args) }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: (...args: unknown[]) => Reflect.apply(mocks.consumeFixedWindowLimit, null, args) }))

const { GET } = await import("./route")
const { VisionLinkClientError } = await import("@/lib/integrations/visionlink/visionlink-client")

function request() {
  return new NextRequest("http://localhost/api/cron/fuel-visionlink-sync", { headers: { authorization: "Bearer cron-secret" } })
}

const CONFIG = { clientId: "id", clientSecret: "secret", scope: "", syncEnabled: true, hasCredentials: true }

describe("GET /api/cron/fuel-visionlink-sync", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret"
    vi.clearAllMocks()
    mocks.verifyCronRequest.mockReturnValue(true)
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.loadVisionLinkConfig.mockResolvedValue(CONFIG)
    mocks.withCronLock.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run())
    mocks.syncVisionLink.mockResolvedValue({ from: "2026-10-16", to: "2026-10-29", assets: 6, matched: 5, unmatched: [], inserted: 60, updated: 10, skippedDays: {} })
    mocks.syncVisionLinkHourly.mockResolvedValue({ from: "2026-10-16", to: "2026-10-30", vehicles: 6, segments: 900, hoursWritten: 300, failedVehicles: [] })
  })

  it("rechaza una petición sin autorización", async () => {
    mocks.verifyCronRequest.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(mocks.syncVisionLink).not.toHaveBeenCalled()
  })

  it("respeta el interruptor del submódulo de control", async () => {
    mocks.isRouteOperational.mockResolvedValue(false)
    expect(await (await GET(request())).json()).toMatchObject({ outcome: "disabled" })
    expect(mocks.isRouteOperational).toHaveBeenCalledWith("/combustibles/fuentes")
    expect(mocks.syncVisionLink).not.toHaveBeenCalled()
  })

  it("informa deshabilitado —no falla— sin credenciales o con el sync apagado", async () => {
    mocks.loadVisionLinkConfig.mockResolvedValue({ ...CONFIG, clientSecret: "", hasCredentials: false })
    expect(await (await GET(request())).json()).toMatchObject({ outcome: "disabled", reason: "sin credenciales" })
    mocks.loadVisionLinkConfig.mockResolvedValue({ ...CONFIG, syncEnabled: false })
    expect(await (await GET(request())).json()).toMatchObject({ outcome: "disabled", reason: "sync deshabilitado" })
    expect(mocks.syncVisionLink).not.toHaveBeenCalled()
  })

  it("sincroniza y devuelve el resumen", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "success", code: "FUEL_CRON_SUCCESS", inserted: 60, matched: 5 })
    expect(mocks.withCronLock).toHaveBeenCalledWith("fuel-visionlink-sync", expect.any(Function))
  })

  it("corre los tramos por hora después del diario, con 14 días, y los informa como hourly", async () => {
    const order: string[] = []
    mocks.syncVisionLink.mockImplementation(async () => { order.push("diario"); return { inserted: 60, matched: 5, unmatched: [] } })
    mocks.syncVisionLinkHourly.mockImplementation(async () => { order.push("horario"); return { vehicles: 6, segments: 900, hoursWritten: 300, failedVehicles: [] } })
    const body = await (await GET(request())).json()
    expect(order).toEqual(["diario", "horario"])
    expect(mocks.syncVisionLinkHourly).toHaveBeenCalledWith(CONFIG, { lookbackDays: 14 })
    expect(body).toMatchObject({ outcome: "success", inserted: 60, hourly: { segments: 900, hoursWritten: 300 } })
  })

  it("si los tramos por hora fallan, el diario sigue siendo un éxito y el fallo se informa en hourly", async () => {
    mocks.syncVisionLinkHourly.mockRejectedValue(new VisionLinkClientError("VISIONLINK_RATE_LIMITED", 429))
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "success", code: "FUEL_CRON_SUCCESS", inserted: 60, hourly: { errorCode: "VISIONLINK_RATE_LIMITED" } })
  })

  it("si el diario falla, no corre los tramos por hora", async () => {
    mocks.syncVisionLink.mockRejectedValue(new VisionLinkClientError("VISIONLINK_AUTH_FAILED", 401))
    expect((await GET(request())).status).toBe(503)
    expect(mocks.syncVisionLinkHourly).not.toHaveBeenCalled()
  })

  it("informa conflicto cuando otra corrida tiene el lock", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true })
    expect((await GET(request())).status).toBe(409)
  })

  it("falla con el código del cliente y sin detalles del proveedor", async () => {
    mocks.syncVisionLink.mockRejectedValue(new VisionLinkClientError("VISIONLINK_AUTH_FAILED", 401))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual(expect.objectContaining({ outcome: "failed", errorCode: "VISIONLINK_AUTH_FAILED" }))
  })
})

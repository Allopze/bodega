import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  cronRequestSource: vi.fn(() => null),
  parseCronAllowedSources: vi.fn(() => []),
  verifyCronRequest: vi.fn(() => true),
  verifyCronInternalRequest: vi.fn(() => false),
  isRouteOperational: vi.fn(),
  syncVisionLink: vi.fn(),
  readVisionLinkConfig: vi.fn(),
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
vi.mock("@/lib/integrations/visionlink/visionlink-settings", () => ({ readVisionLinkConfig: (...args: unknown[]) => Reflect.apply(mocks.readVisionLinkConfig, null, args) }))
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
    mocks.readVisionLinkConfig.mockReturnValue(CONFIG)
    mocks.withCronLock.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run())
    mocks.syncVisionLink.mockResolvedValue({ from: "2026-10-16", to: "2026-10-29", assets: 6, matched: 5, unmatched: [], inserted: 60, updated: 10, skippedDays: {} })
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
    expect(mocks.isRouteOperational).toHaveBeenCalledWith("/combustibles/control")
    expect(mocks.syncVisionLink).not.toHaveBeenCalled()
  })

  it("informa deshabilitado —no falla— sin credenciales o con el sync apagado", async () => {
    mocks.readVisionLinkConfig.mockReturnValue({ ...CONFIG, clientSecret: "", hasCredentials: false })
    expect(await (await GET(request())).json()).toMatchObject({ outcome: "disabled", reason: "sin credenciales" })
    mocks.readVisionLinkConfig.mockReturnValue({ ...CONFIG, syncEnabled: false })
    expect(await (await GET(request())).json()).toMatchObject({ outcome: "disabled", reason: "sync deshabilitado" })
    expect(mocks.syncVisionLink).not.toHaveBeenCalled()
  })

  it("sincroniza y devuelve el resumen", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "success", code: "FUEL_CRON_SUCCESS", inserted: 60, matched: 5 })
    expect(mocks.withCronLock).toHaveBeenCalledWith("fuel-visionlink-sync", expect.any(Function))
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

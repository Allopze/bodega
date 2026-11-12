import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  cronRequestSource: vi.fn(() => null),
  parseCronAllowedSources: vi.fn(() => []),
  verifyCronRequest: vi.fn(() => true),
  verifyCronInternalRequest: vi.fn(() => false),
  isRouteOperational: vi.fn(),
  loadWialonConfig: vi.fn(),
  syncWialon: vi.fn(),
  hasStalledWialonCronRun: vi.fn(async () => false),
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
vi.mock("@/lib/integrations/wialon/wialon-settings", () => ({ loadWialonConfig: (...args: unknown[]) => Reflect.apply(mocks.loadWialonConfig, null, args) }))
vi.mock("@/lib/integrations/wialon/wialon-sync", () => ({
  syncWialon: (...args: unknown[]) => Reflect.apply(mocks.syncWialon, null, args),
  hasStalledWialonCronRun: (...args: unknown[]) => Reflect.apply(mocks.hasStalledWialonCronRun, null, args),
}))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: [string, () => Promise<unknown>]) => Reflect.apply(mocks.withCronLock, null, args) }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: (...args: unknown[]) => Reflect.apply(mocks.consumeFixedWindowLimit, null, args) }))

const { GET } = await import("./route")
const { WialonClientError } = await import("@/lib/integrations/wialon/wialon-client")

function request() {
  return new NextRequest("http://localhost/api/cron/fleet-wialon-sync", {
    headers: { authorization: "Bearer cron-secret" },
  })
}

const successResult = {
  runId: "run-1",
  unitsReceived: 2,
  matched: 2,
  unmatched: 0,
  ambiguous: 0,
  duplicateUnits: 0,
  removedUnits: 0,
  positionsUpserted: 2,
  metersSaved: 2,
  skippedNoPosition: 0,
  warnings: [],
  observedAt: "2026-11-12T12:00:00.000Z",
}

describe("GET /api/cron/fleet-wialon-sync", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret"
    vi.clearAllMocks()
    mocks.verifyCronRequest.mockReturnValue(true)
    mocks.verifyCronInternalRequest.mockReturnValue(false)
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.loadWialonConfig.mockResolvedValue({
      baseUrl: "https://hst-api.wialon.com",
      token: "configured",
      syncEnabled: true,
      hasCredentials: true,
      odometerParam: "mileage",
      hourMeterParam: "engine_hours",
      fuelLevelParam: "fuel_level",
    })
    mocks.withCronLock.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run())
    mocks.hasStalledWialonCronRun.mockResolvedValue(false)
    mocks.syncWialon.mockResolvedValue(successResult)
  })

  it("rechaza una petición sin secreto antes de tocar Wialon", async () => {
    mocks.verifyCronRequest.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ outcome: "unauthorized", code: "FLEET_GPS_CRON_UNAUTHORIZED" })
    expect(mocks.syncWialon).not.toHaveBeenCalled()
  })

  it("queda deshabilitado y sano sin token", async () => {
    mocks.loadWialonConfig.mockResolvedValue({ ...await mocks.loadWialonConfig(), token: "", hasCredentials: false })
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ ok: true, outcome: "disabled", reason: "sin credenciales" })
  })

  it("reporta éxito con el resumen de la corrida", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      outcome: "success",
      matched: 2,
      positions: 2,
      meters: 2,
      observedAt: successResult.observedAt,
    })
  })

  it("las unidades sin vincular o sin posición son contadores, no una corrida parcial", async () => {
    mocks.syncWialon.mockResolvedValue({ ...successResult, matched: 1, unmatched: 1, skippedNoPosition: 1 })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "success", unmatched: 1, skippedNoPosition: 1 })
  })

  it("sólo una respuesta truncada del inventario deja la corrida parcial", async () => {
    mocks.syncWialon.mockResolvedValue({ ...successResult, warnings: ["WIALON_UNIT_LIMIT"] })
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "partial", warnings: ["WIALON_UNIT_LIMIT"] })
  })

  it("falla con un token rechazado", async () => {
    mocks.syncWialon.mockRejectedValue(new WialonClientError("WIALON_AUTH_FAILED"))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "failed", health: "unhealthy", errorCode: "WIALON_AUTH_FAILED" })
  })

  it("trata el límite del proveedor como degradado, no como caída total", async () => {
    mocks.syncWialon.mockRejectedValue(new WialonClientError("WIALON_RATE_LIMITED"))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "partial", errorCode: "WIALON_RATE_LIMITED" })
  })

  it("reporta una corrida solapada como conflicto", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "locked" })
    const response = await GET(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "conflict", code: "FLEET_GPS_CRON_ACTIVE_RUN" })
  })

  it("una corrida colgada es una falla, no un conflicto sano", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "locked" })
    mocks.hasStalledWialonCronRun.mockResolvedValue(true)
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "failed", errorCode: "WIALON_SYNC_STALLED" })
  })
})

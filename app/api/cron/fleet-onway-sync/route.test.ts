import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  cronRequestSource: vi.fn(() => null),
  parseCronAllowedSources: vi.fn(() => []),
  verifyCronRequest: vi.fn(() => true),
  isRouteOperational: vi.fn(),
  readOnwayConfig: vi.fn(),
  syncOnway: vi.fn(),
  withCronLock: vi.fn(async (_job: string, run: () => Promise<unknown>) => run()),
  consumeFixedWindowLimit: vi.fn(async () => ({ allowed: true, remaining: 9 })),
}))

vi.mock("@/lib/security/cron-auth", () => ({
  cronRequestSource: (...args: unknown[]) => Reflect.apply(mocks.cronRequestSource, null, args),
  parseCronAllowedSources: (...args: unknown[]) => Reflect.apply(mocks.parseCronAllowedSources, null, args),
  verifyCronRequest: (...args: unknown[]) => Reflect.apply(mocks.verifyCronRequest, null, args),
}))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: (...args: unknown[]) => Reflect.apply(mocks.isRouteOperational, null, args) }))
vi.mock("@/lib/integrations/onway/onway-settings", () => ({ readOnwayConfig: (...args: unknown[]) => Reflect.apply(mocks.readOnwayConfig, null, args) }))
vi.mock("@/lib/integrations/onway/onway-sync", () => ({ syncOnway: (...args: unknown[]) => Reflect.apply(mocks.syncOnway, null, args) }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: [string, () => Promise<unknown>]) => Reflect.apply(mocks.withCronLock, null, args) }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: (...args: unknown[]) => Reflect.apply(mocks.consumeFixedWindowLimit, null, args) }))

const { GET } = await import("./route")
const { OnwayClientError } = await import("@/lib/integrations/onway/onway-client")

function request() {
  return new NextRequest("http://localhost/api/cron/fleet-onway-sync", {
    headers: { authorization: "Bearer cron-secret" },
  })
}

describe("GET /api/cron/fleet-onway-sync", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret"
    vi.clearAllMocks()
    mocks.verifyCronRequest.mockReturnValue(true)
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.readOnwayConfig.mockResolvedValue({ username: "configured", password: "configured", syncEnabled: true, hasCredentials: true })
    mocks.withCronLock.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run())
    // El mock tiene que devolver `SyncOnwayResult` COMPLETO: la ruta lee
    // `result.warnings.length` para decidir entre `success` y `partial`, y con
    // el mock incompleto reventaba con TypeError dentro del `try`, se
    // clasificaba como `failed` y respondía 503. `vi.fn()` no está tipado, así
    // que TypeScript no lo cazaba.
    mocks.syncOnway.mockResolvedValue({
      received: 5, matched: 4, rejected: 0, unmatched: 1, unmatchedPlates: ["SIN-VINCULO"],
      observedAt: "2026-08-29T00:00:00.000Z", alerts: 0, points: 12, trips: 3, warnings: [],
    })
  })

  it("rejects unauthorized requests before touching OnWay", async () => {
    mocks.verifyCronRequest.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ outcome: "unauthorized", code: "FLEET_GPS_CRON_UNAUTHORIZED" })
    expect(mocks.syncOnway).not.toHaveBeenCalled()
  })

  it("stays healthy when automation is not configured", async () => {
    mocks.readOnwayConfig.mockResolvedValue({ username: "", password: "", syncEnabled: true, hasCredentials: false })
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ ok: true, outcome: "disabled", reason: "sin credenciales" })
  })

  it("returns the bounded synchronization summary", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "success", code: "FLEET_GPS_CRON_SUCCESS", matched: 4 })
  })

  it("classifies an interactive challenge as degraded", async () => {
    mocks.syncOnway.mockRejectedValue(new OnwayClientError("ONWAY_INTERACTIVE_AUTH_REQUIRED"))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "partial", code: "FLEET_GPS_CRON_PARTIAL" })
  })

  it("reports an overlapping run as a conflict", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "locked" })
    const response = await GET(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "conflict", code: "FLEET_GPS_CRON_ACTIVE_RUN" })
  })
})

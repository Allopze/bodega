import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  cronRequestSource: vi.fn(() => null),
  parseCronAllowedSources: vi.fn(() => []),
  verifyCronRequest: vi.fn(() => true),
  isRouteOperational: vi.fn(),
  syncAramco: vi.fn(),
  readAramcoConfig: vi.fn(),
  withCronLock: vi.fn(async (_job: string, run: () => Promise<unknown>) => run()),
  consumeFixedWindowLimit: vi.fn(async () => ({ allowed: true, remaining: 9 })),
}))

vi.mock("@/lib/security/cron-auth", () => ({
  verifyCronSecret: (...args: unknown[]) => Reflect.apply(mocks.verifyCronSecret, null, args),
  cronRequestSource: (...args: unknown[]) => Reflect.apply(mocks.cronRequestSource, null, args),
  parseCronAllowedSources: (...args: unknown[]) => Reflect.apply(mocks.parseCronAllowedSources, null, args),
  verifyCronRequest: (...args: unknown[]) => Reflect.apply(mocks.verifyCronRequest, null, args),
}))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: (...args: unknown[]) => Reflect.apply(mocks.isRouteOperational, null, args) }))
vi.mock("@/lib/combustibles/aramco-sync", () => ({ syncAramco: (...args: unknown[]) => Reflect.apply(mocks.syncAramco, null, args) }))
vi.mock("@/lib/combustibles/aramco-settings", () => ({ readAramcoConfig: (...args: unknown[]) => Reflect.apply(mocks.readAramcoConfig, null, args) }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: [string, () => Promise<unknown>]) => Reflect.apply(mocks.withCronLock, null, args) }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: (...args: unknown[]) => Reflect.apply(mocks.consumeFixedWindowLimit, null, args) }))

const { GET } = await import("./route")
const { AramcoTwoFactorRequiredError } = await import("@/lib/combustibles/aramco-client")

function request() {
  return new NextRequest("http://localhost/api/cron/fuel-aramco-sync", { headers: { authorization: "Bearer cron-secret" } })
}

describe("GET /api/cron/fuel-aramco-sync", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret"
    vi.clearAllMocks()
    mocks.verifyCronSecret.mockReturnValue(true)
    mocks.verifyCronRequest.mockReturnValue(true)
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.readAramcoConfig.mockResolvedValue({ documentNumber: "1-9", password: "1", syncEnabled: true, hasCredentials: true })
    mocks.withCronLock.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run())
    mocks.syncAramco.mockResolvedValue({ imported: 4, refreshed: 2, batches: 1, transactions: 6, pendingPlates: [], skippedGroups: [], from: "2026-04-01", to: "2026-08-31" })
  })

  it("rejects an unauthorized request", async () => {
    mocks.verifyCronSecret.mockReturnValue(false)
    mocks.verifyCronRequest.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ outcome: "unauthorized", code: "FUEL_CRON_UNAUTHORIZED" })
    expect(mocks.syncAramco).not.toHaveBeenCalled()
  })

  it("reports disabled when the import module is off", async () => {
    mocks.isRouteOperational.mockResolvedValue(false)
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ outcome: "disabled", code: "FUEL_CRON_DISABLED" })
    expect(mocks.syncAramco).not.toHaveBeenCalled()
  })

  it("reports disabled -not failed- when nobody configured credentials", async () => {
    // Reportarlo como error dispararía una alerta diaria por una integración
    // que simplemente no está en uso.
    mocks.readAramcoConfig.mockResolvedValue({ documentNumber: "", password: "", syncEnabled: true, hasCredentials: false })
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ outcome: "disabled", reason: "sin credenciales" })
    expect(mocks.syncAramco).not.toHaveBeenCalled()
  })

  it("does not run when the automation is switched off", async () => {
    mocks.readAramcoConfig.mockResolvedValue({ documentNumber: "1-9", password: "1", syncEnabled: false, hasCredentials: true })
    const response = await GET(request())
    expect(await response.json()).toMatchObject({ outcome: "disabled", reason: "sync deshabilitado" })
    expect(mocks.syncAramco).not.toHaveBeenCalled()
  })

  it("reports success and includes the sync summary", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, outcome: "success", code: "FUEL_CRON_SUCCESS", imported: 4, batches: 1 })
  })

  it("reports failed when the portal breaks", async () => {
    mocks.syncAramco.mockRejectedValue(new Error("Aramco respondió 500"))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, outcome: "failed", error: "Aramco respondió 500" })
  })

  it("reports failed when Aramco starts demanding a second factor", async () => {
    mocks.syncAramco.mockRejectedValue(new AramcoTwoFactorRequiredError())
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, outcome: "failed" })
  })

  it("reports conflict when another run holds the lock", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "locked" })
    const response = await GET(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "conflict", code: "FUEL_CRON_ACTIVE_RUN" })
  })

  it("reports rate limiting before touching the provider", async () => {
    mocks.consumeFixedWindowLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const response = await GET(request())
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ outcome: "rate_limited", code: "FUEL_CRON_RATE_LIMITED" })
    expect(mocks.syncAramco).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  cronRequestSource: vi.fn(() => null),
  parseCronAllowedSources: vi.fn(() => []),
  verifyCronRequest: vi.fn(() => true),
  isRouteOperational: vi.fn(),
  syncCopecReports: vi.fn(),
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
vi.mock("@/lib/combustibles/copec-sync", () => ({ syncCopecReports: (...args: unknown[]) => Reflect.apply(mocks.syncCopecReports, null, args) }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: [string, () => Promise<unknown>]) => Reflect.apply(mocks.withCronLock, null, args) }))
vi.mock("@/lib/services/rate-limit", () => ({ consumeFixedWindowLimit: (...args: unknown[]) => Reflect.apply(mocks.consumeFixedWindowLimit, null, args) }))

const { GET } = await import("./route")

function request() {
  return new NextRequest("http://localhost/api/cron/fuel-copec-sync", { headers: { authorization: "Bearer cron-secret" } })
}

describe("GET /api/cron/fuel-copec-sync", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret"
    vi.clearAllMocks()
    mocks.verifyCronSecret.mockReturnValue(true)
    mocks.verifyCronRequest.mockReturnValue(true)
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.withCronLock.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run())
    mocks.syncCopecReports.mockResolvedValue({ from: "2026-08-01", to: "2026-08-31", imported: 10, received: 3, pending: 0, reports: ["Diesel:x.xlsx"], unavailable: [], unmappedCards: [] })
  })

  it("rejects an unauthorized request", async () => {
    mocks.verifyCronSecret.mockReturnValue(false)
    mocks.verifyCronRequest.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ outcome: "unauthorized", code: "FUEL_CRON_UNAUTHORIZED" })
    expect(mocks.syncCopecReports).not.toHaveBeenCalled()
  })

  it("reports disabled when the import module is off", async () => {
    mocks.isRouteOperational.mockResolvedValue(false)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "disabled", code: "FUEL_CRON_DISABLED" })
  })

  it("reports success and includes the sync summary", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, outcome: "success", code: "FUEL_CRON_SUCCESS", imported: 10 })
  })

  it("reports failed when the portal never delivers a file for a period", async () => {
    mocks.syncCopecReports.mockRejectedValue(new Error("Copec no entregó ningún archivo"))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "failed", code: "FUEL_CRON_FAILED" })
  })

  it("reports conflict when another run holds the lock", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "another run in progress" })
    const response = await GET(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "conflict", code: "FUEL_CRON_ACTIVE_RUN" })
  })

  it("reports rate limiting before touching the provider", async () => {
    mocks.consumeFixedWindowLimit.mockResolvedValue({ allowed: false, remaining: 0 })
    const response = await GET(request())
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ outcome: "rate_limited", code: "FUEL_CRON_RATE_LIMITED" })
    expect(mocks.syncCopecReports).not.toHaveBeenCalled()
  })
})

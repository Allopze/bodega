import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  isRouteOperational: vi.fn(),
  checkFuelStatementNotifications: vi.fn(),
  withCronLock: vi.fn(async (_job: string, run: () => Promise<unknown>) => run()),
}))

vi.mock("@/lib/security/cron-auth", () => ({ verifyCronSecret: (...args: unknown[]) => mocks.verifyCronSecret(...args) }))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: (...args: unknown[]) => mocks.isRouteOperational(...args) }))
vi.mock("@/lib/combustibles/notifications", () => ({ checkFuelStatementNotifications: (...args: unknown[]) => mocks.checkFuelStatementNotifications(...args) }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: [string, () => Promise<unknown>]) => mocks.withCronLock(...args) }))

const { GET } = await import("./route")

function request() {
  return new NextRequest("http://localhost/api/cron/fuel-statement-notifications", { headers: { authorization: "Bearer cron-secret" } })
}

describe("GET /api/cron/fuel-statement-notifications", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret"
    vi.clearAllMocks()
    mocks.verifyCronSecret.mockReturnValue(true)
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.withCronLock.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run())
    mocks.checkFuelStatementNotifications.mockResolvedValue(undefined)
  })

  it("rejects an unauthorized request", async () => {
    mocks.verifyCronSecret.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ outcome: "unauthorized", code: "FUEL_CRON_UNAUTHORIZED" })
    expect(mocks.checkFuelStatementNotifications).not.toHaveBeenCalled()
  })

  it("reports disabled when the statement module is off", async () => {
    mocks.isRouteOperational.mockResolvedValue(false)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "disabled", code: "FUEL_CRON_DISABLED" })
  })

  it("reports success on a normal run", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, outcome: "success", code: "FUEL_CRON_SUCCESS" })
  })

  it("reports failed when the check throws", async () => {
    mocks.checkFuelStatementNotifications.mockRejectedValue(new Error("boom"))
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
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  readDtePortalConfig: vi.fn(),
  readSalesSyncConfig: vi.fn(),
  readChipaxConfig: vi.fn(),
  selectWhere: vi.fn(),
  evaluateDteSyncHealth: vi.fn(),
  notifyDteSyncHealthChange: vi.fn(),
  assertDtePortalStartsAllowed: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock("@/lib/security/cron-auth", () => ({
  verifyCronSecret: (...args: unknown[]) => mocks.verifyCronSecret(...args),
}))
vi.mock("@/lib/services/dte-portal/config", () => ({
  readDtePortalConfig: (...args: unknown[]) => mocks.readDtePortalConfig(...args),
}))
vi.mock("@/lib/services/billing/config", () => ({
  readSalesSyncConfig: (...args: unknown[]) => mocks.readSalesSyncConfig(...args),
  readChipaxConfig: (...args: unknown[]) => mocks.readChipaxConfig(...args),
}))
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: (...args: unknown[]) => mocks.selectWhere(...args) }) }),
  },
}))
vi.mock("@/lib/services/dte-portal/health", () => ({
  evaluateDteSyncHealth: (...args: unknown[]) => mocks.evaluateDteSyncHealth(...args),
}))
vi.mock("@/lib/services/dte-portal/health-alerts", () => ({
  notifyDteSyncHealthChange: (...args: unknown[]) => mocks.notifyDteSyncHealthChange(...args),
}))
vi.mock("@/lib/services/dte-portal/operation-lease", () => ({
  assertDtePortalStartsAllowed: (...args: unknown[]) => mocks.assertDtePortalStartsAllowed(...args),
  isIntentionalDtePortalCutoverPause: (error: unknown) => {
    const barrier = typeof error === "object" && error !== null
      ? (error as { barrier?: unknown }).barrier
      : undefined
    return barrier === "paused" || barrier === "cutover"
  },
}))
vi.mock("@/lib/logger", () => ({ logger: { error: (...args: unknown[]) => mocks.loggerError(...args) } }))

const { GET } = await import("./route")

function request() {
  return new NextRequest("http://localhost/api/cron/dte-sync-health", {
    headers: { authorization: "Bearer health-secret" },
  })
}

const healthy = {
  status: "healthy" as const,
  code: "DTE_HEALTH_OK",
  checkedAt: "2026-08-11T11:10:00.000Z",
  domains: [{
    name: "purchases" as const,
    status: "healthy" as const,
    code: "DTE_HEALTH_SUCCESS",
    slot: "2026-08-11T07:00",
    expectedPeriods: ["2026-08", "2026-07"],
  }],
}

describe("GET /api/cron/dte-sync-health", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, CRON_SECRET: "health-secret" }
    vi.clearAllMocks()
    mocks.verifyCronSecret.mockReturnValue(true)
    mocks.readDtePortalConfig.mockResolvedValue({
      syncEnabled: true,
      credentials: { rutUsr: "user", rutEmp: "company", clave: "secret", codEmp: "433" },
    })
    mocks.readSalesSyncConfig.mockReturnValue({ enabled: false })
    mocks.readChipaxConfig.mockReturnValue({ enabled: false, syncEnabled: false, hasCredentials: false, companyTaxId: "" })
    mocks.selectWhere.mockResolvedValue([])
    mocks.evaluateDteSyncHealth.mockReturnValue(healthy)
    mocks.notifyDteSyncHealthChange.mockResolvedValue(undefined)
    mocks.assertDtePortalStartsAllowed.mockResolvedValue(undefined)
  })

  it("rejects an untrusted health runner", async () => {
    mocks.verifyCronSecret.mockReturnValue(false)

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: "DTE_HEALTH_UNAUTHORIZED", status: "critical" })
    expect(mocks.evaluateDteSyncHealth).not.toHaveBeenCalled()
  })

  it("passes cron-only evidence to the evaluator and returns a redacted health DTO", async () => {
    mocks.selectWhere
      .mockResolvedValueOnce([{ period: "2026-08", status: "success", trigger: "cron", correlationId: "batch", startedAt: "2026-08-11T11:02:00.000Z" }])
      .mockResolvedValueOnce([{ period: "2026-08", status: "success", trigger: "cron", correlationId: "batch", startedAt: "2026-08-11T11:02:00.000Z" }])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      outcome: "healthy",
      code: "DTE_HEALTH_OK",
      status: "healthy",
      domains: healthy.domains,
    })
    expect(mocks.evaluateDteSyncHealth).toHaveBeenCalledWith(expect.objectContaining({
      dteRuns: [expect.objectContaining({ trigger: "cron", correlationId: "batch" })],
      salesRuns: [expect.objectContaining({ trigger: "cron", correlationId: "batch" })],
    }))
  })

  it("does not convert a notification failure into a liveness failure", async () => {
    mocks.notifyDteSyncHealthChange.mockRejectedValue(new Error("smtp-password"))

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain("smtp-password")
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "[cron/dte-sync-health] alert delivery failed",
      { code: "DTE_HEALTH_NOTIFICATION_FAILED" },
    )
  })

  it("treats a controlled credential cutover as intentionally disabled for both portal domains", async () => {
    mocks.assertDtePortalStartsAllowed.mockRejectedValue({ code: "DTE_PORTAL_STARTS_PAUSED", barrier: "paused" })
    mocks.evaluateDteSyncHealth.mockReturnValue({
      ...healthy,
      status: "disabled",
      code: "DTE_HEALTH_DISABLED",
      domains: [{ ...healthy.domains[0], status: "disabled", code: "DTE_HEALTH_INTENTIONALLY_DISABLED" }],
    })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "disabled", code: "DTE_HEALTH_DISABLED" })
    expect(mocks.evaluateDteSyncHealth).toHaveBeenCalledWith(expect.objectContaining({
      dteEnabled: false,
      salesEnabled: false,
    }))
  })

  it("fails closed instead of treating a malformed cutover barrier as intentional", async () => {
    mocks.assertDtePortalStartsAllowed.mockRejectedValue({ code: "DTE_PORTAL_STARTS_PAUSED", barrier: "corrupt-value" })

    const response = await GET(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, code: "DTE_HEALTH_EVALUATOR_FAILED", status: "critical" })
    expect(mocks.evaluateDteSyncHealth).not.toHaveBeenCalled()
  })

  it("fails closed when the evaluator/database path throws without leaking its error", async () => {
    mocks.selectWhere.mockRejectedValue(new Error("postgres://user:password@host"))

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({ ok: false, code: "DTE_HEALTH_EVALUATOR_FAILED", status: "critical" })
    expect(JSON.stringify(body)).not.toContain("password")
  })
})

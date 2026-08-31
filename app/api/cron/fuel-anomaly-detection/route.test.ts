import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  isRouteOperational: vi.fn(),
  syncAnomalyRuleCatalog: vi.fn(),
  runAllBatchRules: vi.fn(),
  withCronLock: vi.fn(async (_job: string, run: () => Promise<unknown>) => run()),
}))

vi.mock("@/lib/security/cron-auth", () => ({ verifyCronSecret: (...args: unknown[]) => mocks.verifyCronSecret(...args) }))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: (...args: unknown[]) => mocks.isRouteOperational(...args) }))
vi.mock("@/lib/combustibles/anomaly-cases", () => ({ syncAnomalyRuleCatalog: (...args: unknown[]) => mocks.syncAnomalyRuleCatalog(...args) }))
vi.mock("@/lib/combustibles/anomaly-detector", () => ({ runAllBatchRules: (...args: unknown[]) => mocks.runAllBatchRules(...args) }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: (...args: [string, () => Promise<unknown>]) => mocks.withCronLock(...args) }))

const { GET } = await import("./route")

function request() {
  return new NextRequest("http://localhost/api/cron/fuel-anomaly-detection", {
    headers: { authorization: "Bearer cron-secret" },
  })
}

describe("GET /api/cron/fuel-anomaly-detection", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret"
    vi.clearAllMocks()
    mocks.verifyCronSecret.mockReturnValue(true)
    mocks.isRouteOperational.mockResolvedValue(true)
    mocks.withCronLock.mockImplementation(async (_job: string, run: () => Promise<unknown>) => run())
    mocks.runAllBatchRules.mockResolvedValue([
      { ruleCode: "litros_supera_capacidad", created: 0, skipped: 0, status: "completed" },
      { ruleCode: "sello_repetido", created: 0, skipped: 0, status: "no_detector" },
    ])
  })

  it("rejects an unauthorized request without running anything", async () => {
    mocks.verifyCronSecret.mockReturnValue(false)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ outcome: "unauthorized", code: "FUEL_CRON_UNAUTHORIZED" })
    expect(mocks.runAllBatchRules).not.toHaveBeenCalled()
  })

  it("reports disabled without running anything when the module is off", async () => {
    mocks.isRouteOperational.mockResolvedValue(false)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "disabled", code: "FUEL_CRON_DISABLED" })
    expect(mocks.runAllBatchRules).not.toHaveBeenCalled()
  })

  it("reports success when no rule failed", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, outcome: "success", code: "FUEL_CRON_SUCCESS" })
    expect(body.results).toHaveLength(2)
  })

  // CO-029/CO-039: antes esto era indistinguible de un 200 sin novedad.
  it("reports partial when some rules failed but not all", async () => {
    mocks.runAllBatchRules.mockResolvedValue([
      { ruleCode: "litros_supera_capacidad", created: 0, skipped: 0, status: "completed" },
      { ruleCode: "variacion_brusca_consumo", created: 0, skipped: 0, status: "failed" },
    ])
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "partial", code: "FUEL_CRON_PARTIAL" })
  })

  it("reports failed when every rule failed", async () => {
    mocks.runAllBatchRules.mockResolvedValue([
      { ruleCode: "litros_supera_capacidad", created: 0, skipped: 0, status: "failed" },
    ])
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "failed", code: "FUEL_CRON_FAILED" })
  })

  it("reports conflict without duplicating work when another run is in progress", async () => {
    mocks.withCronLock.mockResolvedValue({ skipped: true, reason: "another run in progress" })
    const response = await GET(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "conflict", code: "FUEL_CRON_ACTIVE_RUN" })
  })
})

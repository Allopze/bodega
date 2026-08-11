import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  readSalesSyncConfig: vi.fn(),
  syncBillingInvoices: vi.fn(),
  currentPeriod: vi.fn(),
  previousBillingPeriod: vi.fn(),
  assertDtePortalStartsAllowed: vi.fn(),
  nanoid: vi.fn(),
  loggerError: vi.fn(),
  classifyDteFailure: vi.fn(),
}))

vi.mock("@/lib/security/cron-auth", () => ({
  verifyCronSecret: (...args: unknown[]) => mocks.verifyCronSecret(...args),
}))
vi.mock("@/lib/services/billing/config", () => ({
  readSalesSyncConfig: (...args: unknown[]) => mocks.readSalesSyncConfig(...args),
}))
vi.mock("@/lib/services/billing/sync", () => ({
  syncBillingInvoices: (...args: unknown[]) => mocks.syncBillingInvoices(...args),
  currentPeriod: (...args: unknown[]) => mocks.currentPeriod(...args),
  previousBillingPeriod: (...args: unknown[]) => mocks.previousBillingPeriod(...args),
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
vi.mock("@/lib/services/dte-portal/failure", () => ({
  classifyDteFailure: (...args: unknown[]) => mocks.classifyDteFailure(...args),
}))
vi.mock("@/lib/id", () => ({ nanoid: (...args: unknown[]) => mocks.nanoid(...args) }))
vi.mock("@/lib/logger", () => ({ logger: { error: (...args: unknown[]) => mocks.loggerError(...args) } }))

const { GET } = await import("./route")

function request() {
  return new NextRequest("http://localhost/api/cron/billing-sales-sync", {
    headers: { authorization: "Bearer test-cron-secret" },
  })
}

function result(overrides: Partial<{
  status: "success" | "partial" | "failed" | "skipped"
  runId: string
  skipReason: "provider_disabled" | "not_configured" | "active_run" | "unsupported"
}> = {}) {
  return {
    runId: "sales-run",
    correlationId: "sales-batch",
    provider: "factura_en_linea" as const,
    scope: "sales_invoices" as const,
    period: "2026-08",
    status: "success" as const,
    dryRun: false,
    recordsFetched: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsUnchanged: 0,
    duplicatesDetected: 0,
    conflictsDetected: 0,
    errorsCount: 0,
    errorSummary: null,
    ...overrides,
  }
}

describe("GET /api/cron/billing-sales-sync", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, CRON_SECRET: "test-cron-secret" }
    vi.clearAllMocks()
    mocks.verifyCronSecret.mockReturnValue(true)
    mocks.readSalesSyncConfig.mockReturnValue({ enabled: true })
    mocks.assertDtePortalStartsAllowed.mockResolvedValue(undefined)
    mocks.currentPeriod.mockReturnValue("2026-08")
    mocks.previousBillingPeriod.mockReturnValue("2026-07")
    mocks.nanoid.mockReturnValue("sales-batch")
    mocks.syncBillingInvoices.mockResolvedValue(result())
    mocks.classifyDteFailure.mockReturnValue({ code: "DTE_SETTINGS_INVALID", summary: "Configuración segura inválida." })
  })

  it("returns disabled without touching the DTE cutover fence when sales automation is off", async () => {
    mocks.readSalesSyncConfig.mockReturnValue({ enabled: false })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "disabled", code: "DTE_CRON_DISABLED" })
    expect(mocks.assertDtePortalStartsAllowed).not.toHaveBeenCalled()
    expect(mocks.syncBillingInvoices).not.toHaveBeenCalled()
  })

  it("returns disabled before sales can reach FacturaEnLínea during a controlled cutover", async () => {
    mocks.assertDtePortalStartsAllowed.mockRejectedValue({ code: "DTE_PORTAL_STARTS_PAUSED", barrier: "paused" })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "disabled", code: "DTE_CRON_DISABLED" })
    expect(mocks.syncBillingInvoices).not.toHaveBeenCalled()
  })

  it("treats a malformed cutover barrier as a critical configuration failure", async () => {
    mocks.assertDtePortalStartsAllowed.mockRejectedValue({ code: "DTE_PORTAL_STARTS_PAUSED", barrier: "corrupt-value" })

    const response = await GET(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "failed", code: "DTE_CRON_FAILED", health: "critical" })
    expect(mocks.syncBillingInvoices).not.toHaveBeenCalled()
  })

  it("uses one correlation id for current and prior sales periods", async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(mocks.syncBillingInvoices).toHaveBeenNthCalledWith(1, expect.objectContaining({
      period: "2026-08", correlationId: "sales-batch", trigger: "cron",
    }))
    expect(mocks.syncBillingInvoices).toHaveBeenNthCalledWith(2, expect.objectContaining({
      period: "2026-07", correlationId: "sales-batch", trigger: "cron",
    }))
  })

  it("keeps a live run separate from a disabled/provider configuration", async () => {
    mocks.syncBillingInvoices.mockResolvedValue(result({
      status: "skipped",
      runId: "",
      skipReason: "active_run",
    }))

    const response = await GET(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "conflict", code: "DTE_CRON_ACTIVE_RUN" })
  })

  it("maps an unsafe cutover-fence error to the redacted critical contract", async () => {
    mocks.assertDtePortalStartsAllowed.mockRejectedValue(new Error("internal database password"))

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(JSON.stringify(body)).not.toContain("internal database password")
    expect(mocks.loggerError).toHaveBeenCalledWith(
      { correlationId: "sales-batch" },
      "[cron/billing-sales-sync] configuración segura no disponible",
      { code: "DTE_SETTINGS_INVALID" },
    )
  })
})

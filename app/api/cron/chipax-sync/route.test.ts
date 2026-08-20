import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  readChipaxConfig: vi.fn(),
  syncBillingInvoices: vi.fn(),
  syncBankTransactions: vi.fn(),
  currentPeriod: vi.fn(),
  previousBillingPeriod: vi.fn(),
  nanoid: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock("@/lib/security/cron-auth", () => ({ verifyCronSecret: (...args: unknown[]) => mocks.verifyCronSecret(...args) }))
vi.mock("@/lib/services/billing/chipax-settings", () => ({ readChipaxConfig: async () => mocks.readChipaxConfig() }))
vi.mock("@/lib/services/billing/sync", () => ({
  syncBillingInvoices: (...args: unknown[]) => mocks.syncBillingInvoices(...args),
  syncBankTransactions: (...args: unknown[]) => mocks.syncBankTransactions(...args),
  currentPeriod: () => mocks.currentPeriod(),
  previousBillingPeriod: (...args: unknown[]) => mocks.previousBillingPeriod(...args),
}))
vi.mock("@/lib/id", () => ({ nanoid: (...args: unknown[]) => mocks.nanoid(...args) }))
vi.mock("@/lib/logger", () => ({ logger: { error: (...args: unknown[]) => mocks.loggerError(...args) } }))

const { GET } = await import("./route")

function request() {
  return new NextRequest("http://localhost/api/cron/chipax-sync", {
    headers: { authorization: "Bearer cron-secret" },
  })
}

function syncResult(scope: "sales_invoices" | "bank_transactions", period: string, overrides: Record<string, unknown> = {}) {
  return {
    runId: `${scope}-${period}`,
    correlationId: "chipax-batch",
    provider: "chipax",
    scope,
    period,
    status: "success",
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

describe("GET /api/cron/chipax-sync", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret"
    vi.clearAllMocks()
    mocks.verifyCronSecret.mockReturnValue(true)
    mocks.readChipaxConfig.mockReturnValue({ enabled: true, syncEnabled: true, hasCredentials: true, companyTaxId: "78023530-6" })
    mocks.currentPeriod.mockReturnValue("2026-08")
    mocks.previousBillingPeriod.mockReturnValue("2026-07")
    mocks.nanoid.mockReturnValue("chipax-batch")
    mocks.syncBillingInvoices
      .mockResolvedValueOnce(syncResult("sales_invoices", "2026-08"))
      .mockResolvedValueOnce(syncResult("sales_invoices", "2026-07"))
    mocks.syncBankTransactions.mockResolvedValue(syncResult("bank_transactions", "2026-08"))
  })

  it("does not run when automation is disabled even if Chipax is available", async () => {
    mocks.readChipaxConfig.mockReturnValue({ enabled: true, syncEnabled: false, hasCredentials: true, companyTaxId: "78023530-6" })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "disabled", code: "DTE_CRON_DISABLED" })
    expect(mocks.syncBillingInvoices).not.toHaveBeenCalled()
  })

  it("runs every scope with one correlation id and current/prior periods", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(mocks.syncBillingInvoices).toHaveBeenNthCalledWith(1, expect.objectContaining({ period: "2026-08", correlationId: "chipax-batch" }))
    expect(mocks.syncBillingInvoices).toHaveBeenNthCalledWith(2, expect.objectContaining({ period: "2026-07", correlationId: "chipax-batch" }))
    // Las cartolas cubren los mismos dos períodos: con sólo el mes en curso, los
    // movimientos del último día del mes anterior no se pedían nunca más.
    expect(mocks.syncBankTransactions).toHaveBeenNthCalledWith(1, expect.objectContaining({ period: "2026-08", correlationId: "chipax-batch" }))
    expect(mocks.syncBankTransactions).toHaveBeenNthCalledWith(2, expect.objectContaining({ period: "2026-07", correlationId: "chipax-batch" }))
    expect((await response.json()).scopes).toHaveLength(4)
  })

  it("returns conflict only for an active run and degraded for partial data", async () => {
    mocks.syncBillingInvoices.mockReset()
    mocks.syncBillingInvoices
      .mockResolvedValueOnce(syncResult("sales_invoices", "2026-08", { status: "skipped", skipReason: "active_run", runId: "" }))
      .mockResolvedValueOnce(syncResult("sales_invoices", "2026-07", { status: "success" }))
    // Sólo la corrida activa: cualquier `partial` en el lote manda sobre el
    // conflicto (cronContractFor lo resuelve antes) y taparía lo que se prueba acá.
    mocks.syncBankTransactions.mockResolvedValue(syncResult("bank_transactions", "2026-08", { status: "success" }))
    const response = await GET(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "conflict", code: "DTE_CRON_ACTIVE_RUN" })

    mocks.syncBillingInvoices.mockReset()
    mocks.syncBillingInvoices.mockResolvedValue(syncResult("sales_invoices", "2026-08", { status: "partial" }))
    mocks.syncBankTransactions.mockResolvedValue(syncResult("bank_transactions", "2026-08", { status: "partial" }))
    const degraded = await GET(request())
    expect(degraded.status).toBe(503)
    expect(await degraded.json()).toMatchObject({ outcome: "partial", code: "DTE_CRON_PARTIAL" })
  })
})

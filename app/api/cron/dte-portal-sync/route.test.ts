import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  verifyCronSecret: vi.fn(),
  readDtePortalConfig: vi.fn(),
  syncDteDocuments: vi.fn(),
  rollingSyncPeriods: vi.fn(),
  nanoid: vi.fn(),
  loggerError: vi.fn(),
  classifyDteFailure: vi.fn(),
}))

vi.mock("@/lib/security/cron-auth", () => ({
  verifyCronSecret: (...args: unknown[]) => mocks.verifyCronSecret(...args),
}))
vi.mock("@/lib/services/dte-portal/config", () => ({
  readDtePortalConfig: (...args: unknown[]) => mocks.readDtePortalConfig(...args),
}))
vi.mock("@/lib/services/dte-portal/sync", () => ({
  syncDteDocuments: (...args: unknown[]) => mocks.syncDteDocuments(...args),
  rollingSyncPeriods: (...args: unknown[]) => mocks.rollingSyncPeriods(...args),
}))
vi.mock("@/lib/services/dte-portal/client", () => ({
  DtePortalClient: class DtePortalClient {},
}))
vi.mock("@/lib/services/dte-portal/failure", () => ({
  classifyDteFailure: (...args: unknown[]) => mocks.classifyDteFailure(...args),
}))
vi.mock("@/lib/id", () => ({ nanoid: (...args: unknown[]) => mocks.nanoid(...args) }))
vi.mock("@/lib/logger", () => ({ logger: { error: (...args: unknown[]) => mocks.loggerError(...args) } }))

const { GET } = await import("./route")

const configured = {
  baseUrl: "https://clientes.dtefacturaenlinea.cl/facturaenlinea",
  credentials: { rutUsr: "user", rutEmp: "company", clave: "secret", codEmp: "433" },
  delayMs: 500,
  requestTimeoutMs: 120_000,
  syncEnabled: true,
  importerEmail: null,
}

function request() {
  return new NextRequest("http://localhost/api/cron/dte-portal-sync", {
    headers: { authorization: "Bearer test-cron-secret" },
  })
}

function result(overrides: Partial<{
  status: "success" | "partial" | "failed" | "skipped"
  runId: string
  error: string
  skipReason: "disabled" | "invalid_barrier" | "active_run"
}> = {}) {
  return {
    runId: "run-1",
    periodo: "2026-08",
    codEmp: "433",
    status: "success" as const,
    rowsSeen: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    correlationId: "batch-1",
    ...overrides,
  }
}

describe("GET /api/cron/dte-portal-sync", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, CRON_SECRET: "test-cron-secret" }
    vi.clearAllMocks()
    mocks.verifyCronSecret.mockReturnValue(true)
    mocks.readDtePortalConfig.mockResolvedValue(configured)
    mocks.rollingSyncPeriods.mockReturnValue(["2026-08", "2026-07"])
    mocks.nanoid.mockReturnValue("batch-1")
    mocks.syncDteDocuments.mockResolvedValue(result())
    mocks.classifyDteFailure.mockReturnValue({ code: "DTE_SETTINGS_INVALID", summary: "Configuración segura inválida." })
  })

  it("rejects an unauthorized runner without attempting a sync", async () => {
    mocks.verifyCronSecret.mockReturnValue(false)

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ outcome: "unauthorized", code: "DTE_CRON_UNAUTHORIZED" })
    expect(mocks.syncDteDocuments).not.toHaveBeenCalled()
  })

  it("returns an intentional disabled contract without creating a period run", async () => {
    mocks.readDtePortalConfig.mockResolvedValue({ ...configured, syncEnabled: false })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "disabled", code: "DTE_CRON_DISABLED", health: "disabled" })
    expect(mocks.syncDteDocuments).not.toHaveBeenCalled()
  })

  it("uses one correlation id for the current and prior DTE periods", async () => {
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ outcome: "success", correlationId: "batch-1" })
    expect(mocks.syncDteDocuments).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      periodo: "2026-08", correlationId: "batch-1", trigger: "cron",
    }))
    expect(mocks.syncDteDocuments).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      periodo: "2026-07", correlationId: "batch-1", trigger: "cron",
    }))
  })

  it("returns waiting/409 for a live-run conflict", async () => {
    mocks.syncDteDocuments.mockResolvedValue(result({
      status: "skipped",
      runId: "",
      error: "DTE_SYNC_ACTIVE_RUN: Ya hay una corrida en curso.",
      skipReason: "active_run",
    }))

    const response = await GET(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ outcome: "conflict", code: "DTE_CRON_ACTIVE_RUN", health: "waiting" })
  })

  it("reports a whole controlled-cutover pause as disabled", async () => {
    mocks.syncDteDocuments.mockResolvedValue(result({
      status: "skipped",
      runId: "",
      error: "DTE_SYNC_DISABLED: La sincronización está pausada.",
      skipReason: "disabled",
    }))

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "disabled", code: "DTE_CRON_DISABLED" })
  })

  it("reports a malformed cutover barrier as critical rather than intentional disabled", async () => {
    mocks.syncDteDocuments.mockResolvedValue(result({
      status: "skipped",
      runId: "",
      error: "DTE_SETTINGS_BARRIER_INVALID: El cerco requiere revisión.",
      skipReason: "invalid_barrier",
    }))

    const response = await GET(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "failed", code: "DTE_CRON_FAILED", health: "critical" })
  })

  it("does not certify a mixed batch when cutover interrupts only one period", async () => {
    mocks.syncDteDocuments
      .mockResolvedValueOnce(result({ status: "success", runId: "run-current" }))
      .mockResolvedValueOnce(result({
        status: "skipped",
        runId: "",
        error: "DTE_SYNC_DISABLED: La sincronización está pausada.",
        skipReason: "disabled",
      }))

    const response = await GET(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ outcome: "partial", code: "DTE_CRON_PARTIAL", health: "degraded" })
  })

  it("redacts a configuration exception from its wire response", async () => {
    mocks.readDtePortalConfig.mockRejectedValue(new Error("actual-portal-password"))

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(JSON.stringify(body)).not.toContain("actual-portal-password")
    expect(mocks.loggerError).toHaveBeenCalledWith(
      { correlationId: "batch-1" },
      "[cron/dte-portal-sync] configuración inválida",
      { code: "DTE_SETTINGS_INVALID" },
    )
  })
})

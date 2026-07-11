import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockSettingFindFirst = vi.fn()
const mockUserFindFirst = vi.fn()
const mockDownloadCopecReport = vi.fn()
const mockSaveState = vi.fn()

class MockCopecReportUnavailableError extends Error {}

vi.mock("@/db", () => ({
  db: {
    query: {
      systemSettings: { findFirst: (...args: unknown[]) => mockSettingFindFirst(...args) },
      users: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
      fuelVehicles: { findMany: vi.fn() },
      fuelImportBatches: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoUpdate: (...args: unknown[]) => mockSaveState(...args) })),
    })),
    transaction: vi.fn(),
  },
}))
vi.mock("@/db/schema", () => ({
  fuelConsumptionRecords: {}, fuelImportBatches: {}, fuelVehicles: {}, systemSettings: {}, users: {},
}))
vi.mock("@/lib/combustibles/copec-reports", () => ({
  downloadCopecReport: (...args: unknown[]) => mockDownloadCopecReport(...args),
  isCopecReportUnavailableError: (error: unknown) => error instanceof MockCopecReportUnavailableError,
}))

const { buildCopecSyncPeriods, syncCopecReportPeriod } = await import("../copec-sync")

describe("buildCopecSyncPeriods", () => {
  it("divides an initial historical import into Copec-sized contiguous periods", () => {
    expect(buildCopecSyncPeriods("2026-01-01", "2026-02-04", 31)).toEqual([
      { from: "2026-01-01", to: "2026-01-31" },
      { from: "2026-02-01", to: "2026-02-04" },
    ])
  })

  it("does not request a period when the cursor is already after the target date", () => {
    expect(buildCopecSyncPeriods("2026-02-05", "2026-02-04", 31)).toEqual([])
  })
})

describe("syncCopecReportPeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // importCopecPeriod only looks up the importer user when this env var is
    // set — stub it here so the test doesn't depend on the ambient shell/CI
    // environment ever defining it.
    vi.stubEnv("COPEC_SYNC_IMPORTER_EMAIL", "importer@chome.cl")
    mockSettingFindFirst.mockResolvedValue(undefined)
    mockUserFindFirst.mockResolvedValue({ id: "user-1" })
    mockSaveState.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("continues and checkpoints when Copec has no downloadable file for a period", async () => {
    mockDownloadCopecReport.mockRejectedValue(new MockCopecReportUnavailableError("sin archivo"))

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" })

    expect(result).toMatchObject({ imported: 0, unavailable: ["TCT", "TAE"] })
    expect(mockDownloadCopecReport).toHaveBeenCalledTimes(2)
    expect(mockSaveState).toHaveBeenCalledOnce()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockSettingFindFirst = vi.fn()
const mockUserFindFirst = vi.fn()
const mockBatchFindFirst = vi.fn()
const mockVehiclesFindMany = vi.fn()
const mockConsumptionFindMany = vi.fn()
const mockDownloadCopecReports = vi.fn()
const mockParseConsumptionExcel = vi.fn()
const mockSaveState = vi.fn()
const mockTransaction = vi.fn()
const mockTxInsertValues = vi.fn()
const mockTxUpdateSet = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: {
      systemSettings: { findFirst: (...args: unknown[]) => mockSettingFindFirst(...args) },
      users: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
      fuelVehicles: { findMany: (...args: unknown[]) => mockVehiclesFindMany(...args) },
      fuelImportBatches: { findFirst: (...args: unknown[]) => mockBatchFindFirst(...args) },
      fuelConsumptionRecords: { findMany: (...args: unknown[]) => mockConsumptionFindMany(...args) },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoUpdate: (...args: unknown[]) => mockSaveState(...args) })),
    })),
    transaction: (cb: (tx: unknown) => unknown) => mockTransaction(cb),
  },
}))
vi.mock("@/db/schema", () => ({
  fuelConsumptionRecords: {}, fuelImportBatches: {}, fuelVehicles: {}, systemSettings: {}, users: {},
}))
vi.mock("@/lib/combustibles/copec-reports", () => ({
  downloadCopecReports: (...args: unknown[]) => mockDownloadCopecReports(...args),
}))
vi.mock("@/lib/combustibles/consumption-import", () => ({
  parseConsumptionExcel: (...args: unknown[]) => mockParseConsumptionExcel(...args),
}))

const { buildCopecSyncPeriods, getCopecSyncStartOptions, setCopecSyncStartDate, syncCopecReportPeriod } = await import("../copec-sync")

describe("buildCopecSyncPeriods", () => {
  it("divides an initial historical import into closed calendar months", () => {
    expect(buildCopecSyncPeriods("2026-01-01", "2026-02-28")).toEqual([
      { from: "2026-01-01", to: "2026-01-31" },
      { from: "2026-02-01", to: "2026-02-28" },
    ])
  })

  it("does not request a partial open month", () => {
    expect(buildCopecSyncPeriods("2026-01-01", "2026-02-04")).toEqual([
      { from: "2026-01-01", to: "2026-01-31" },
    ])
  })

  it("does not request a period when the cursor is already after the target date", () => {
    expect(buildCopecSyncPeriods("2026-02-05", "2026-02-04")).toEqual([])
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
    mockBatchFindFirst.mockResolvedValue(undefined)
    mockUserFindFirst.mockResolvedValue({ id: "user-1" })
    mockSaveState.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("does NOT advance the cursor when Copec delivered no file at all (portal likely broken)", async () => {
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: true },
      { product: "bluemax", unavailable: true },
    ])

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" })

    expect(result).toMatchObject({ imported: 0, unavailable: ["Diesel", "BlueMax"], reports: [] })
    expect(mockDownloadCopecReports).toHaveBeenCalledWith([
      { product: "diesel", from: "2026-02-01", to: "2026-02-28" },
      { product: "bluemax", from: "2026-02-01", to: "2026-02-28" },
    ])
    // El cursor se queda en el inicio del período (no avanza a 2026-03-01), para
    // reintentar en vez de saltarse datos por un portal caído.
    expect(mockSaveState).toHaveBeenCalledOnce()
    const savedState = JSON.parse(mockSaveState.mock.calls[0]![0].set.value)
    expect(savedState.cursor).toBe("2026-02-01")
  })

  it("uses the authenticated operator for a manual sync without requiring cron configuration", async () => {
    vi.unstubAllEnvs()
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: true },
      { product: "bluemax", unavailable: true },
    ])

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    expect(mockUserFindFirst).not.toHaveBeenCalled()
    expect(mockSaveState).toHaveBeenCalledOnce()
  })

  it("re-imports only the newly-linked plates into an existing batch (no duplicates)", async () => {
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    // El archivo trae AAA (ya importada antes) y BBB (recién vinculada a un vehículo).
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA"), row("BBB")], errors: [], duplicates: [] })
    mockVehiclesFindMany.mockResolvedValue([
      { id: "v-aaa", plate: "AAA", worksiteId: "W1" },
      { id: "v-bbb", plate: "BBB", worksiteId: "W1" },
    ])
    // Ya existe un lote para (archivo, W1) con solo AAA cargada.
    mockBatchFindFirst.mockResolvedValue({ id: "batch-1" })
    mockConsumptionFindMany.mockResolvedValue([{ patente: "AAA" }])

    const insertedRecords: Array<{ patente: string }> = []
    const tx = {
      insert: () => ({ values: (records: Array<{ patente: string }>) => { insertedRecords.push(...records); return mockTxInsertValues(records) } }),
      update: () => ({ set: (patch: unknown) => { mockTxUpdateSet(patch); return { where: vi.fn() } } }),
    }
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    // Solo BBB se inserta; AAA no se duplica.
    expect(result.imported).toBe(1)
    expect(insertedRecords).toHaveLength(1)
    expect(insertedRecords[0]!.patente).toBe("BBB")
    // El lote existente se actualiza con los totales de la patente nueva.
    expect(mockTxUpdateSet).toHaveBeenCalledOnce()
  })
})

describe("Copec synchronization start date", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("COPEC_SYNC_START_DATE", "2020-01-01")
    mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2020-02-01", lastRunAt: null, pending: [] }) })
    mockBatchFindFirst.mockResolvedValue({ periodoHasta: "2026-06-30" })
    mockSaveState.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("only offers dates after the latest active fuel import", async () => {
    const options = await getCopecSyncStartOptions()

    expect(options).toMatchObject({
      currentStart: "2026-07-01",
      minimumStart: "2026-07-01",
      latestImportedUntil: "2026-06-30",
    })
  })

  it("rejects a configured start that would overlap an imported period", async () => {
    await expect(setCopecSyncStartDate("2026-06-01", "2020-02-01"))
      .rejects.toThrow("posterior al último período importado")
    expect(mockSaveState).not.toHaveBeenCalled()
  })

  it("allows skipping ahead to a date after imported periods", async () => {
    const result = await setCopecSyncStartDate("2026-07-01", "2020-02-01")

    expect(result.currentStart).toBe("2026-07-01")
    expect(mockSaveState).toHaveBeenCalledOnce()
  })

  it("rejects a stale edit instead of overwriting a newer sync cursor", async () => {
    await expect(setCopecSyncStartDate("2026-07-01", "2020-01-01"))
      .rejects.toThrow("La sincronización cambió")
    expect(mockSaveState).not.toHaveBeenCalled()
  })
})

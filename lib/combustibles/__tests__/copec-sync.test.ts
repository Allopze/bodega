import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockSettingFindFirst = vi.fn()
const mockUserFindFirst = vi.fn()
const mockBatchFindFirst = vi.fn()
const mockVehiclesFindMany = vi.fn()
const mockConsumptionFindMany = vi.fn()
const mockDownloadCopecReports = vi.fn()
const mockParseConsumptionExcel = vi.fn()
const mockParseTaeReceiptExcel = vi.fn()
const mockImportTaeReceipts = vi.fn()
const mockSaveState = vi.fn()
const mockTransaction = vi.fn()
const mockTxInsertValues = vi.fn()
const mockTxUpdateSet = vi.fn()

const mockSaveStateReturning = vi.fn().mockResolvedValue([{ key: "combustibles.copec.sync" }])

vi.mock("@/db", () => ({
  db: {
    query: {
      systemSettings: { findFirst: (...args: unknown[]) => mockSettingFindFirst(...args) },
      users: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
      fuelVehicles: { findMany: (...args: unknown[]) => mockVehiclesFindMany(...args) },
      fuelProviderMappings: { findMany: vi.fn().mockResolvedValue([]) },
      fuelImportBatches: { findFirst: (...args: unknown[]) => mockBatchFindFirst(...args) },
      fuelConsumptionRecords: { findMany: (...args: unknown[]) => mockConsumptionFindMany(...args) },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: (...args: unknown[]) => {
          mockSaveState(...args)
          return { returning: mockSaveStateReturning }
        },
      })),
    })),
    transaction: (cb: (tx: unknown) => unknown) => mockTransaction(cb),
  },
}))
vi.mock("@/db/schema", () => ({
  // Marcadas para que el mock de `tx.insert` distinga el lote de los registros.
  fuelConsumptionRecords: { __table: "records" }, fuelImportBatches: { __table: "batches" },
  fuelVehicles: {}, fuelProviderMappings: {}, systemSettings: {}, users: {},
}))
// La conciliación tiene sus propias pruebas contra Postgres; acá se aísla para
// que estos casos sigan midiendo sólo la importación.
vi.mock("@/lib/combustibles/fuel-reconciliation", () => ({
  reconcileFuelProviderRun: vi.fn().mockResolvedValue({ reconciled: 0, matched: 0 }),
}))
vi.mock("@/lib/combustibles/fuel-provider-ledger", () => ({
  beginFuelProviderSyncRun: vi.fn().mockResolvedValue({ id: "run-1", correlationId: "corr-1" }),
  recordFuelProviderIssues: vi.fn().mockResolvedValue({ rejected: 0 }),
  recordFuelProviderValidation: vi.fn().mockResolvedValue({ accepted: 1, rejected: 0, pending: 0 }),
  finishFuelProviderSyncRun: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/combustibles/copec-reports", () => ({
  downloadCopecReports: (...args: unknown[]) => mockDownloadCopecReports(...args),
}))
vi.mock("@/lib/combustibles/consumption-import", () => ({
  parseConsumptionExcel: (...args: unknown[]) => mockParseConsumptionExcel(...args),
}))
// El canal TAE (recepciones) tiene sus propias pruebas; aquí se aísla para que
// estos casos sigan midiendo solo la importación TCT.
vi.mock("@/lib/combustibles/tae-receipt-import", () => ({
  parseTaeReceiptExcel: (...args: unknown[]) => mockParseTaeReceiptExcel(...args),
}))
vi.mock("@/lib/combustibles/tae-receipts", async (importOriginal) => ({
  // La clase de error va real: la sincronización la distingue con `instanceof`.
  ...(await importOriginal<typeof import("@/lib/combustibles/tae-receipts")>()),
  importTaeReceipts: (...args: unknown[]) => mockImportTaeReceipts(...args),
}))

const { buildCopecSyncPeriods, copecProjectionHash, copecSourceRowKey, getCopecSyncPlan, getCopecSyncStartOptions, setCopecSyncStartDate, syncCopecReportPeriod, syncCopecReports } = await import("../copec-sync")
const { AUTOMATED_SOURCES } = await import("../fuel-sources")
const { collectStrings } = await import("./drizzle-filter")

// Cada grupo (faena, período, fuente) ahora corre bajo lock + recheck DENTRO
// de la transacción (CO-026) — `tx.query...` reutiliza los mismos mocks que
// antes vivían en `db.query...`, así que los `mockResolvedValue`/`Once` de
// cada test siguen aplicando en el mismo orden.
function makeTx() {
  const insertedRecords: Array<{ patente: string }> = []
  const insertedBatches: Array<Record<string, unknown>> = []
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      fuelImportBatches: { findFirst: (...args: unknown[]) => mockBatchFindFirst(...args) },
      fuelConsumptionRecords: { findMany: (...args: unknown[]) => mockConsumptionFindMany(...args) },
    },
    // El insert del LOTE recibe un objeto y el de REGISTROS un array: se
    // distinguen por tabla, no por la forma del argumento. Asumir array dejaba
    // sin cobertura todo el camino de "crear un lote nuevo".
    insert: (table: { __table?: string }) => ({
      values: (payload: unknown) => {
        if (table?.__table === "records") insertedRecords.push(...(payload as Array<{ patente: string }>))
        else insertedBatches.push(payload as Record<string, unknown>)
        return mockTxInsertValues(payload)
      },
    }),
    update: () => ({ set: (patch: unknown) => { mockTxUpdateSet(patch); return { where: vi.fn() } } }),
    delete: () => ({ where: vi.fn() }),
    _insertedRecords: insertedRecords,
    _insertedBatches: insertedBatches,
  }
  return tx
}

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

describe("copecSourceRowKey", () => {
  it("identifica la fila por patente y no por su posición en el Excel", () => {
    // Copec regenera el Excel en cada descarga, y en el informe de detalle el
    // índice es el de la primera transacción de esa patente: una transacción
    // corregida lo corría y el ledger ganaba una fila nueva, dejando la vieja
    // huérfana para siempre.
    expect(copecSourceRowKey("2026-02-01", "2026-02-28", "diesel", "AB-CD12"))
      .toBe("2026-02-01:2026-02-28:diesel:ABCD12")
    // Mismo vehículo escrito distinto = misma clave.
    expect(copecSourceRowKey("2026-02-01", "2026-02-28", "diesel", "ABCD12"))
      .toBe(copecSourceRowKey("2026-02-01", "2026-02-28", "diesel", "AB-CD12"))
    // El período es parte de la clave: sin él, dos meses de la misma patente
    // colisionarían contra el índice único y el upsert pisaría el historial.
    expect(copecSourceRowKey("2026-03-01", "2026-03-31", "diesel", "ABCD12"))
      .not.toBe(copecSourceRowKey("2026-02-01", "2026-02-28", "diesel", "ABCD12"))
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
    mockParseTaeReceiptExcel.mockResolvedValue({ rows: [], errors: [] })
    mockImportTaeReceipts.mockResolvedValue({ inserted: 0, duplicates: 0, unmappedCards: [], unmappedLiters: 0 })
    mockSaveState.mockResolvedValue(undefined)
    mockSaveStateReturning.mockResolvedValue([{ key: "combustibles.copec.sync" }])
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(makeTx()))
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

    // `reports` sigue vacío aunque el canal TAE también se haya consultado: ese
    // arreglo es el que decide si el cursor avanza, y solo debe contar TCT.
    expect(result).toMatchObject({ imported: 0, received: 0, unavailable: ["Diesel", "BlueMax", "TAE Diesel", "TAE BlueMax"], reports: [] })
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

  it("un proveedor faltante en el catálogo no tumba la corrida ni avanza el cursor TAE", async () => {
    // El catálogo de combustibles puede estar sin poblar: `fuel_cycle_movements`
    // exige proveedor, así que TAE no puede importar. Eso es configuración, no
    // una falla — no puede arrastrarse al canal TCT, que ya importó sus lotes.
    const { TaeSupplierMissingError } = await import("../tae-receipts")
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "informe.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [] })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])
    mockParseTaeReceiptExcel.mockResolvedValue({ rows: [{ documentNumber: "G-1", cardNumber: "1", productId: "fuel-diesel", occurredAt: "2026-02-10T10:00:00.000Z", liters: 10, unitPrice: 1, amount: 10, assignment: "", station: "", rawRow: {} }], errors: [] })
    mockImportTaeReceipts.mockRejectedValue(new TaeSupplierMissingError())

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    // TCT importó igual y la corrida no explota.
    expect(result.imported).toBe(1)
    expect(result.unavailable.some((item) => item.includes("proveedor Copec"))).toBe(true)
    // El cursor TCT avanza; el de TAE se queda para reintentar el mes.
    const saved = JSON.parse(mockSaveState.mock.calls[0]![0].set.value)
    expect(saved.cursor).toBe("2026-03-01")
    expect(saved.taeCursor).toBe("2026-02-01")
  })

  it("no avanza el cursor TAE cuando el portal entregó TCT pero no TAE", async () => {
    // `advanced` mide sólo TCT a propósito. Sin cursor propio, ese mes cerrado
    // avanzaba igual y sus recepciones TAE no se reintentaban nunca más.
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports
      .mockResolvedValueOnce([
        { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
        { product: "bluemax", unavailable: true },
      ])
      .mockResolvedValueOnce([
        { product: "diesel", unavailable: true },
        { product: "bluemax", unavailable: true },
      ])
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [] })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    const saved = JSON.parse(mockSaveState.mock.calls[0]![0].set.value)
    expect(saved.cursor).toBe("2026-03-01")
    expect(saved.taeCursor).toBe("2026-02-01")
  })

  it("avanza los dos cursores cuando el portal entregó ambos canales", async () => {
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "informe.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [] })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    const saved = JSON.parse(mockSaveState.mock.calls[0]![0].set.value)
    expect(saved.cursor).toBe("2026-03-01")
    expect(saved.taeCursor).toBe("2026-03-01")
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

  it("la proyección sigue recibiendo las filas tras cambiar la clave del ledger", async () => {
    // La clave se arma en un lado y se reconstruye en otro para filtrar qué filas
    // entran al lote. Si se desincronizan, `groups` queda vacío y se importan
    // CERO registros sin lanzar ningún error.
    const row = (patente: string): unknown => ({ rowIndex: 7, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AB-CD12")], errors: [], duplicates: [] })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-1", plate: "ABCD12", worksiteId: "W1" }])

    const tx = makeTx()
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    expect(result.imported).toBe(1)
    expect(tx._insertedRecords).toHaveLength(1)
  })

  it("atribuye las filas inválidas del archivo a un solo lote, no a cada faena", async () => {
    // `parsed.errors` es del ARCHIVO. Con 2 faenas en el mismo reporte, sumarle
    // el conteo completo a cada lote triplicaba las filas rechazadas.
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({
      rows: [row("AAA"), row("BBB")],
      errors: [{ rowIndex: 9, field: "Patente", message: "requerida" }, { rowIndex: 10, field: "Monto ($)", message: "requerido" }],
      duplicates: [],
    })
    mockVehiclesFindMany.mockResolvedValue([
      { id: "v-aaa", plate: "AAA", worksiteId: "W1" },
      { id: "v-bbb", plate: "BBB", worksiteId: "W2" },
    ])

    const tx = makeTx()
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    const batches = tx._insertedBatches as Array<{ totalFilas: number; filasValidas: number; filasInvalidas: number }>
    expect(batches).toHaveLength(2)
    expect(batches.map((batch) => batch.filasInvalidas)).toEqual([2, 0])
    // El invariante que audita `batch_detail_mismatches` del preflight.
    for (const batch of batches) expect(batch.totalFilas).toBe(batch.filasValidas + batch.filasInvalidas)
  })

  it("mantiene la atribución de filas inválidas al refrescar un lote existente", async () => {
    // La rama de refresco escribía `parsed.errors.length` sin el reparto, así que
    // un mes ya importado volvía a multiplicar las rechazadas en cada faena.
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({
      rows: [row("AAA"), row("BBB")],
      errors: [{ rowIndex: 9, field: "Patente", message: "requerida" }, { rowIndex: 10, field: "Monto ($)", message: "requerido" }],
      duplicates: [],
    })
    mockVehiclesFindMany.mockResolvedValue([
      { id: "v-aaa", plate: "AAA", worksiteId: "W1" },
      { id: "v-bbb", plate: "BBB", worksiteId: "W2" },
    ])
    mockBatchFindFirst.mockResolvedValue({ id: "batch-existente", hashArchivo: "otro" })
    mockConsumptionFindMany.mockResolvedValue([])

    const tx = makeTx()
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    const patches = mockTxUpdateSet.mock.calls
      .map((call) => call[0] as { filasInvalidas?: number; totalFilas?: number; filasValidas?: number })
      .filter((patch) => patch.filasInvalidas !== undefined)
    expect(patches).toHaveLength(2)
    expect(patches.map((patch) => patch.filasInvalidas)).toEqual([2, 0])
    for (const patch of patches) expect(patch.totalFilas).toBe(patch.filasValidas! + patch.filasInvalidas!)
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

    const tx = makeTx()
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    // Solo BBB se inserta; AAA no se duplica.
    expect(result.imported).toBe(1)
    expect(tx._insertedRecords).toHaveLength(1)
    expect(tx._insertedRecords[0]!.patente).toBe("BBB")
    // El lote existente se reconstruye: se actualiza el registro AAA y se
    // fijan los totales del lote, mientras BBB se inserta una sola vez.
    expect(mockTxUpdateSet).toHaveBeenCalledTimes(2)
  })

  it("skips a worksite already imported from another source instead of duplicating its consumption", async () => {
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [] })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])
    // 1ª consulta: no hay lote propio (dedup por fuente exacta). 2ª: sí hay uno
    // importado a mano ('Copec') que cubre el mismo período de esa faena.
    mockBatchFindFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ fuente: "Copec" })

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    expect(result.imported).toBe(0)
    // El recheck ahora corre DENTRO de la transacción (bajo el lock, CO-026),
    // así que sí se llama — pero sin insertar nada, porque encuentra el lote ajeno.
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockTxInsertValues).not.toHaveBeenCalled()
    expect(result.unavailable).toContain("Diesel: faena con importación previa (Copec) en el período")
  })
  describe("open month", () => {
    const OPEN = { from: "2026-08-01", to: "2026-08-31" }

    function withToday(iso: string, run: () => Promise<void>) {
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(new Date(iso))
      return run().finally(() => { vi.useRealTimers() })
    }

    function oneDieselRow() {
      const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
      mockDownloadCopecReports.mockResolvedValue([
        { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
        { product: "bluemax", unavailable: true },
      ])
      mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [] })
      mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])
    }

    it("does NOT advance the cursor past a month that is still open", async () => {
      // Si avanzara, el mes en curso se importaría una vez -parcial- y nunca se
      // volvería a refrescar: es el mecanismo que hace posible la visibilidad.
      oneDieselRow()
      mockBatchFindFirst.mockResolvedValue(undefined)
      await withToday("2026-08-22T12:00:00.000Z", async () => {
        await syncCopecReportPeriod(OPEN, "operator-1")
      })
      expect(mockSaveState).toHaveBeenCalledOnce()
      expect(JSON.parse(mockSaveState.mock.calls[0]![0].set.value)).toMatchObject({ cursor: "2026-08-01" })
    })

    it("advances the cursor once the month has closed", async () => {
      oneDieselRow()
      mockBatchFindFirst.mockResolvedValue(undefined)
      await withToday("2026-09-02T12:00:00.000Z", async () => {
        await syncCopecReportPeriod(OPEN, "operator-1")
      })
      expect(JSON.parse(mockSaveState.mock.calls[0]![0].set.value)).toMatchObject({ cursor: "2026-09-01" })
    })

    it("sets an open batch's totals instead of adding to them", async () => {
      // Sumar sobre lo ya contado duplicaría litros y monto en cada corrida.
      oneDieselRow()
      // Totales viejos: el lote traía menos litros que el reporte de ahora.
      mockBatchFindFirst.mockResolvedValue({ id: "batch-agosto", totalFilas: 1, totalPatentes: 1, totalTarjetas: 1, totalTransacciones: 1, totalCantidad: 60, totalMonto: 30000 })
      mockConsumptionFindMany.mockResolvedValue([{ id: "rec-1", patente: "AAA", vehicleId: "v-aaa" }])
      await withToday("2026-08-22T12:00:00.000Z", async () => {
        const result = await syncCopecReportPeriod(OPEN, "operator-1")
        expect(result.refreshed).toBe(1)
      })
      const batchPatch = mockTxUpdateSet.mock.calls.map((call) => call[0]).find((patch) => patch.totalCantidad !== undefined)
      expect(typeof batchPatch.totalCantidad).toBe("number")
      expect(batchPatch).toMatchObject({ totalCantidad: 100, totalMonto: 50000 })
    })

    it("leaves an open batch untouched when the report has not changed", async () => {
      // El hash de la proyección permite evitar una escritura diaria cuando el
      // contenido del portal es idéntico.
      oneDieselRow()
      mockBatchFindFirst.mockResolvedValue({
        id: "batch-agosto",
        hashArchivo: copecProjectionHash([{
          rowIndex: 1, patente: "AAA", numeroTarjetas: 1, numeroTransacciones: 2,
          cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {},
        }]),
        totalFilas: 1, totalPatentes: 1, totalTarjetas: 1, totalTransacciones: 2,
        totalCantidad: 100, totalMonto: 50000,
      })
      await withToday("2026-08-22T12:00:00.000Z", async () => {
        const result = await syncCopecReportPeriod(OPEN, "operator-1")
        expect(result).toMatchObject({ imported: 0, refreshed: 0 })
      })
      expect(mockTxUpdateSet).not.toHaveBeenCalled()
      expect(mockConsumptionFindMany).not.toHaveBeenCalled()
    })

    it("stops quietly when the portal has nothing for the open month yet", async () => {
      // El mes en curso puede no existir aún en el portal. Fallar ahí rompería
      // el cron todos los días por algo que no es un problema.
      mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2026-08-01", lastRunAt: null, pending: [] }) })
      mockBatchFindFirst.mockResolvedValue(undefined)
      mockDownloadCopecReports.mockResolvedValue([
        { product: "diesel", unavailable: true },
        { product: "bluemax", unavailable: true },
      ])
      await withToday("2026-08-22T12:00:00.000Z", async () => {
        await expect(syncCopecReports()).resolves.toMatchObject({ imported: 0 })
      })
    })

    it("still fails loudly when a CLOSED month delivers no file", async () => {
      // Ese caso sí indica portal cambiado o credenciales rotas, y enmascararlo
      // fue lo que dejó la sync "al día" con la tabla vacía.
      mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2026-06-01", lastRunAt: null, pending: [] }) })
      mockBatchFindFirst.mockResolvedValue(undefined)
      mockDownloadCopecReports.mockResolvedValue([
        { product: "diesel", unavailable: true },
        { product: "bluemax", unavailable: true },
      ])
      await withToday("2026-08-22T12:00:00.000Z", async () => {
        await expect(syncCopecReports()).rejects.toThrow(/no entregó ningún archivo/)
      })
    })
  })

  // Regresión: el guard de "import ajeno" excluía SÓLO las fuentes de Copec, así
  // que el primer lote de otro proveedor automático (Aramco) para la misma faena
  // y período hacía que esta sincronización devolviera `imported: 0` y se saltara
  // la faena en silencio. Dos contratos de combustible en la misma faena y mes es
  // el caso normal, no una duplicación.
  it("excludes every automated provider from the foreign-import guard, not just its own sources", async () => {
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [] })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])
    // Se corta en el guard (como el caso de arriba) para no depender del insert:
    // el WHERE que nos interesa ya quedó construido igual.
    mockBatchFindFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ fuente: "Copec" })

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    // 1ª consulta = dedup por fuente exacta; 2ª = el guard de import ajeno.
    expect(mockBatchFindFirst).toHaveBeenCalledTimes(2)
    const guardLiterals = collectStrings(mockBatchFindFirst.mock.calls[1]?.[0])
    expect(AUTOMATED_SOURCES.filter((source) => !guardLiterals.includes(source))).toEqual([])
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

  it("keeps the explicit cursor even when a foreign batch reaches a later month", async () => {
    // El piso (mes siguiente al último lote activo) es solo informativo: recortar
    // el cursor contra él saltaba en silencio todos los meses intermedios.
    const options = await getCopecSyncStartOptions()

    expect(options).toMatchObject({
      currentStart: "2020-02-01",
      minimumStart: "2026-07-01",
      latestImportedUntil: "2026-06-30",
    })
  })

  it("allows going back before the latest imported period to recover skipped months", async () => {
    const result = await setCopecSyncStartDate("2026-04-01", "2020-02-01")

    expect(result.currentStart).toBe("2026-04-01")
    expect(mockSaveState).toHaveBeenCalledOnce()
  })

  it("plans the months a foreign manual batch used to swallow, up to the open one", async () => {
    // Cursor en abril y un lote ajeno que llega hasta julio: el plan debe cubrir
    // abril–agosto, no quedar vacío con "no hay meses nuevos". Agosto es el mes
    // en curso y también entra: se refresca en cada corrida.
    mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2026-04-01", lastRunAt: null, pending: [] }) })
    mockBatchFindFirst.mockResolvedValue({ periodoHasta: "2026-07-31" })
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"))
    try {
      const plan = await getCopecSyncPlan()
      expect(plan.from).toBe("2026-04-01")
      expect(plan.to).toBe("2026-08-31")
      expect(plan.periods).toHaveLength(5)
      expect(plan.periods.at(-1)).toEqual({ from: "2026-08-01", to: "2026-08-31" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("el plan retrocede hasta el mes TAE atrasado, con tope", async () => {
    // TCT iba en agosto y TAE quedó en abril porque el portal no entregó sus
    // informes. Recuperar TAE es volver a pedir esos meses completos, y cada uno
    // es una sesión de navegador: el tope evita que la puesta al día cuelgue el
    // cron. TCT ya importado sale por el atajo del hash sin escribir nada.
    mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2026-08-01", taeCursor: "2026-04-01", lastRunAt: null, pending: [] }) })
    mockBatchFindFirst.mockResolvedValue(undefined)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"))
    try {
      const plan = await getCopecSyncPlan()
      // Tope de 3 meses: no arranca en abril sino en mayo.
      expect(plan.from).toBe("2026-05-01")
    } finally {
      vi.useRealTimers()
    }
  })

  it("no retrocede el plan cuando el canal TAE está al día", async () => {
    mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2026-08-01", taeCursor: "2026-08-01", lastRunAt: null, pending: [] }) })
    mockBatchFindFirst.mockResolvedValue(undefined)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"))
    try {
      expect((await getCopecSyncPlan()).from).toBe("2026-08-01")
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the open month reachable even after importing it", async () => {
    // Un lote del mes en curso dejaría el piso en el mes SIGUIENTE, y el plan
    // quedaría vacío: el mes abierto no volvería a sincronizarse nunca.
    mockSettingFindFirst.mockResolvedValue(undefined)
    mockBatchFindFirst.mockResolvedValue({ periodoHasta: "2026-08-31" })
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"))
    try {
      const options = await getCopecSyncStartOptions()
      expect(options.minimumStart).toBe("2026-08-01")
      const plan = await getCopecSyncPlan()
      expect(plan.periods).toEqual([{ from: "2026-08-01", to: "2026-08-31" }])
    } finally {
      vi.useRealTimers()
    }
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

  // CO-026: la comprobación de arriba es a nivel de aplicación (currentStart);
  // esta es la comprobación a nivel de BD (`setWhere` sobre `updatedAt`) que
  // atrapa la carrera cuando DOS escrituras pasan esa comprobación a la vez —
  // sin esto, la segunda pisaba el cursor de la primera en silencio.
  it("rejects the write itself when another process updated the state row concurrently", async () => {
    mockSaveStateReturning.mockResolvedValueOnce([])

    await expect(setCopecSyncStartDate("2026-07-01", "2020-02-01"))
      .rejects.toThrow("cambió en otra ejecución")
  })
})

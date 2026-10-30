import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CopecReportFailure } from "../copec-reports"

const mockSettingFindFirst = vi.fn()
const mockUserFindFirst = vi.fn()
const mockBatchFindFirst = vi.fn()
const mockVehiclesFindMany = vi.fn()
const mockMappingsFindMany = vi.fn()
const mockConsumptionFindMany = vi.fn()
const mockDownloadCopecReports = vi.fn()
const mockPortalSessions = vi.fn()
const mockParseConsumptionExcel = vi.fn()
const mockParseCopecDetail = vi.fn()
const mockParseTaeReceiptExcel = vi.fn()
const mockParseTaeReceiptRecords = vi.fn()
const mockImportTaeReceipts = vi.fn()
const mockSaveState = vi.fn()
const mockTransaction = vi.fn()
const mockTxInsertValues = vi.fn()
const mockTxUpdateSet = vi.fn()

const mockSaveStateReturning = vi.fn().mockResolvedValue([{ key: "combustibles.copec.sync" }])
/** Lotes existentes del período, para el barrido de lotes sin respaldo. */
const mockBatchFindMany = vi.fn().mockResolvedValue([])
const mockProviderTransactionsFindMany = vi.fn().mockResolvedValue([])
const mockStorageLocationsFindMany = vi.fn().mockResolvedValue([])
const mockCoverageRows: Array<{ provider: string; sourceAccount: string; channel: string; product: string; periodMonth: string; status: string }> = []
const mockListCopecCoverage = vi.fn(async (from: string, to: string) => mockCoverageRows.filter((row) => row.periodMonth >= `${from.slice(0, 7)}-01` && row.periodMonth <= `${to.slice(0, 7)}-01`))
const mockRecordCopecCoverage = vi.fn(async (input: {
  channel: string
  product: string
  month: string
  status: string
}) => {
  const row = {
    provider: "copec",
    sourceAccount: `${input.channel.toLowerCase()}:${input.product}`,
    channel: input.channel,
    product: input.product,
    periodMonth: input.month,
    status: input.status,
  }
  const index = mockCoverageRows.findIndex((existing) => existing.sourceAccount === row.sourceAccount && existing.periodMonth === row.periodMonth)
  if (index < 0) mockCoverageRows.push(row)
  else mockCoverageRows[index] = row
})

vi.mock("@/db", () => ({
  db: {
    query: {
      systemSettings: { findFirst: (...args: unknown[]) => mockSettingFindFirst(...args) },
      users: { findFirst: (...args: unknown[]) => mockUserFindFirst(...args) },
      fuelVehicles: { findMany: (...args: unknown[]) => mockVehiclesFindMany(...args) },
      fuelProviderMappings: { findMany: (...args: unknown[]) => mockMappingsFindMany(...args) },
      fuelImportBatches: {
        findFirst: (...args: unknown[]) => mockBatchFindFirst(...args),
        // Usado por el barrido de lotes que los informes ya no respaldan.
        findMany: (...args: unknown[]) => mockBatchFindMany(...args),
      },
      fuelConsumptionRecords: { findMany: (...args: unknown[]) => mockConsumptionFindMany(...args) },
      fuelProviderTransactions: { findMany: (...args: unknown[]) => mockProviderTransactionsFindMany(...args) },
      fuelStorageLocations: { findMany: (...args: unknown[]) => mockStorageLocationsFindMany(...args) },
    },
    insert: vi.fn(() => ({
      values: vi.fn((payload: { value: string }) => ({
        onConflictDoNothing: (...args: unknown[]) => {
          // La creación inicial no lleva `set`; se normaliza la captura para
          // que las aserciones de estado midan el mismo valor persistido.
          mockSaveState({ ...(args[0] as object), set: { value: payload.value } })
          return { returning: mockSaveStateReturning }
        },
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
  fuelVehicles: {}, fuelProviderMappings: {}, fuelProviderTransactions: { provider: {}, sourceAccount: {}, occurredAt: {}, sourceRowKey: {} },
  fuelStorageLocations: { taeCardNumber: {}, productId: {}, isActive: {} },
  fuelProviderFiles: {}, fuelProviderPeriodCoverage: {}, fuelProviderEventRevisions: {}, systemSettings: {}, users: {},
}))
vi.mock("@/lib/combustibles/copec-coverage-store", () => ({
  listCopecPeriodCoverage: (...args: [string, string]) => mockListCopecCoverage(...args),
  recordCopecPeriodCoverage: (...args: [Parameters<typeof mockRecordCopecCoverage>[0]]) => mockRecordCopecCoverage(...args),
  recordCopecFile: vi.fn().mockResolvedValue(undefined),
  updateCopecFileParseResult: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/combustibles/copec-evidence", () => ({
  COPEC_PARSER_VERSION: "copec-xlsx-test",
  archiveCopecEvidence: vi.fn(async (id: string, buffer: Buffer) => ({
    id,
    storagePath: `copec-evidence/${id}.xlsx.enc`,
    sourceSha256: "a".repeat(64),
    encryptedSha256: "b".repeat(64),
    encryptionIv: "aXY=",
    encryptionAuthTag: "YXV0aFRhZw==",
    encryptionKeyVersion: "v1",
    sourceBytes: buffer.byteLength,
  })),
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
vi.mock("@/lib/combustibles/copec-ws", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/combustibles/copec-ws")>()),
  // Una sesión Copec por corrida, sea web service o portal; cada `download` es
  // lo que antes era una llamada a `downloadCopecReports`, así que las
  // aserciones siguen igual. Sin esto, un `COPEC_CLIENT_RUT` en el entorno
  // haría que la prueba consultara a Copec de verdad.
  withCopecSourceSession: async (run: (session: unknown) => Promise<unknown>) => {
    mockPortalSessions()
    return run({ download: (...args: unknown[]) => mockDownloadCopecReports(...args) })
  },
}))
vi.mock("@/lib/combustibles/consumption-import", () => ({
  parseConsumptionExcel: (...args: unknown[]) => mockParseConsumptionExcel(...args),
  parseCopecDetail: (...args: unknown[]) => mockParseCopecDetail(...args),
}))
// El canal TAE (recepciones) tiene sus propias pruebas; aquí se aísla para que
// estos casos sigan midiendo solo la importación TCT.
vi.mock("@/lib/combustibles/tae-receipt-import", () => ({
  parseTaeReceiptExcel: (...args: unknown[]) => mockParseTaeReceiptExcel(...args),
  parseTaeReceiptRecords: (...args: unknown[]) => mockParseTaeReceiptRecords(...args),
}))
vi.mock("@/lib/combustibles/tae-receipts", async (importOriginal) => ({
  // La clase de error va real: la sincronización la distingue con `instanceof`.
  ...(await importOriginal<typeof import("@/lib/combustibles/tae-receipts")>()),
  importTaeReceipts: (...args: unknown[]) => mockImportTaeReceipts(...args),
}))

const { buildCopecSyncPeriods, copecProjectionHash, copecSourceRowKey, copecSweepPeriods, getCopecSyncPlan, getCopecSyncStartOptions, setCopecSyncStartDate, syncCopecReportPeriod, syncCopecReports } = await import("../copec-sync")
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

// El cron y el botón «Sincronizar» recorren la misma lista: el mes en curso
// primero, aunque el plan esté atascado en un mes histórico. Antes el botón sólo
// pedía el mes pendiente más antiguo y el mes en curso nunca entraba a mano.
describe("copecSweepPeriods", () => {
  it("antepone el mes en curso a un plan atascado en un mes histórico", () => {
    expect(copecSweepPeriods([{ from: "2025-01-01", to: "2025-01-31" }], "2026-10-29")).toEqual([
      { from: "2026-10-01", to: "2026-10-31" },
      { from: "2025-01-01", to: "2025-01-31" },
    ])
  })

  it("no repite el mes en curso cuando el plan ya llegó a él", () => {
    expect(copecSweepPeriods([{ from: "2026-10-01", to: "2026-10-31" }], "2026-10-29")).toEqual([
      { from: "2026-10-01", to: "2026-10-31" },
    ])
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

describe("copecProjectionHash", () => {
  const row = (patente: string, monto: number) => ({
    rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2,
    cantidadUnidad: 100, monto, rendimientoPromedio: 3, rawRow: {},
  })

  it("no cambia porque Copec reordene las filas del Excel", () => {
    // El portal REGENERA el archivo en cada descarga: hashear en orden de
    // archivo hacía que un reordenamiento sin ningún cambio de datos
    // invalidara el hash y reconstruyera el lote entero, dejando `updated_at`
    // nuevo en todos sus registros.
    expect(copecProjectionHash([row("AAA11", 10), row("BBB22", 20)]))
      .toBe(copecProjectionHash([row("BBB22", 20), row("AAA11", 10)]))
  })

  it("sí cambia cuando cambia un dato", () => {
    expect(copecProjectionHash([row("AAA11", 10)]))
      .not.toBe(copecProjectionHash([row("AAA11", 11)]))
  })

  it("sí cambia cuando el archivo gana una fila inválida", () => {
    expect(copecProjectionHash([row("AAA11", 10)], 0))
      .not.toBe(copecProjectionHash([row("AAA11", 10)], 1))
  })
})

describe("syncCopecReportPeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBatchFindMany.mockResolvedValue([])
    mockCoverageRows.length = 0
    mockProviderTransactionsFindMany.mockResolvedValue([])
    mockStorageLocationsFindMany.mockResolvedValue([])
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-03-02T12:00:00.000Z"))
    mockMappingsFindMany.mockImplementation(async () => {
      const result = mockVehiclesFindMany.mock.results.at(-1)?.value
      const rows = result ? await result : []
      return (Array.isArray(rows) ? rows : []).map((vehicle) => ({
        externalKey: vehicle.plate,
        vehicleId: vehicle.id,
        worksiteId: vehicle.worksiteId,
        effectiveFrom: "2020-01-01",
        effectiveTo: null,
        isActive: true,
        version: 1,
      }))
    })
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
    vi.useRealTimers()
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
    expect(mockDownloadCopecReports).toHaveBeenNthCalledWith(1, [
      { product: "diesel", from: "2026-02-01", to: "2026-02-28" },
      { product: "bluemax", from: "2026-02-01", to: "2026-02-28" },
    ], "TCT")
    expect(mockDownloadCopecReports).toHaveBeenNthCalledWith(2, [
      { product: "diesel", from: "2026-02-01", to: "2026-02-28" },
      { product: "bluemax", from: "2026-02-01", to: "2026-02-28" },
    ], "TAE")
    // El cursor se queda en el inicio del período (no avanza a 2026-03-01), para
    // reintentar en vez de saltarse datos por un portal caído.
    expect(mockSaveState).toHaveBeenCalledOnce()
    const savedState = JSON.parse(mockSaveState.mock.calls[0]![0].set.value)
    expect(savedState.cursor).toBe("2026-02-01")
  })

  it("cierra la corrida como fallida sin avanzar el cursor si el navegador no abre", async () => {
    const { finishFuelProviderSyncRun } = await import("@/lib/combustibles/fuel-provider-ledger")
    const message = "No fue posible abrir el navegador para consultar Copec. La sincronización se detuvo."
    mockDownloadCopecReports.mockRejectedValueOnce(new Error(message))

    await expect(syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1"))
      .rejects.toThrow(message)

    expect(finishFuelProviderSyncRun).toHaveBeenCalledWith("run-1", expect.objectContaining({ status: "failed", error: message }))
    expect(mockSaveState).not.toHaveBeenCalled()
  })

  it("continúa con TAE si falla la descarga del canal TCT", async () => {
    mockDownloadCopecReports
      .mockRejectedValueOnce(new CopecReportFailure("network", "Copec está temporalmente fuera de servicio"))
      .mockResolvedValueOnce([
        { product: "diesel", unavailable: true },
        { product: "bluemax", unavailable: true },
      ])

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    expect(mockDownloadCopecReports).toHaveBeenCalledTimes(2)
    expect(result.unavailable).toContain("Diesel: [network] Copec está temporalmente fuera de servicio")
    expect(mockCoverageRows.some((row) => row.channel === "TCT" && row.product === "diesel" && row.status === "failed")).toBe(true)
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
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [], detail: []  })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])
    mockParseTaeReceiptExcel.mockResolvedValue({ rows: [{ documentNumber: "G-1", cardNumber: "1", productId: "fuel-diesel", occurredAt: "2026-02-10T10:00:00.000Z", liters: 10, unitPrice: 1, amount: 10, assignment: "", station: "", rawRow: {} }], errors: [] })
    mockImportTaeReceipts.mockRejectedValue(new TaeSupplierMissingError())

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    // TCT importó igual y la corrida no explota.
    expect(result.imported).toBe(1)
    expect(result.unavailable.some((item) => item.includes("proveedor Copec"))).toBe(true)
    // Un producto TCT y un producto TAE siguen sin cierre terminal; el cursor
    // legado se conserva en el mes y ya no es la evidencia de cobertura.
    const saved = JSON.parse(mockSaveState.mock.calls[0]![0].set.value)
    expect(saved.cursor).toBe("2026-02-01")
    expect(saved.taeCursor).toBe("2026-02-01")
    expect(mockCoverageRows.some((row) => row.channel === "TCT" && row.product === "diesel" && row.status === "incomplete")).toBe(true)
    expect(mockCoverageRows.some((row) => row.channel === "TCT" && row.product === "bluemax" && row.status === "unknown")).toBe(true)
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
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [], detail: []  })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    const saved = JSON.parse(mockSaveState.mock.calls[0]![0].set.value)
    expect(saved.cursor).toBe("2026-02-01")
    expect(saved.taeCursor).toBe("2026-02-01")
  })

  it("conserva ambos cursores hasta cerrar cobertura de cada producto", async () => {
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "informe.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [], detail: []  })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    const saved = JSON.parse(mockSaveState.mock.calls[0]![0].set.value)
    expect(saved.cursor).toBe("2026-02-01")
    expect(saved.taeCursor).toBe("2026-02-01")
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
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AB-CD12")], errors: [], duplicates: [], detail: []  })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-1", plate: "ABCD12", worksiteId: "W1" }])

    const tx = makeTx()
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    expect(result.imported).toBe(1)
    expect(tx._insertedRecords).toHaveLength(1)
    expect(mockCoverageRows.find((row) => row.channel === "TCT" && row.product === "diesel")?.status).toBe("incomplete")
  })

  it("conserva la proyección previa si el archivo incluye filas inválidas", async () => {
    // Un archivo parcialmente rechazado no cierra cobertura ni reemplaza una
    // proyección que ya era confiable.
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({
      rows: [row("AAA"), row("BBB")],
      errors: [{ rowIndex: 9, field: "Patente", message: "requerida" }, { rowIndex: 10, field: "Monto ($)", message: "requerido" }],
      duplicates: [],
      detail: [],
    })
    mockVehiclesFindMany.mockResolvedValue([
      { id: "v-aaa", plate: "AAA", worksiteId: "W1" },
      { id: "v-bbb", plate: "BBB", worksiteId: "W2" },
    ])

    const tx = makeTx()
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    expect(tx._insertedBatches).toHaveLength(0)
    expect(tx._insertedRecords).toHaveLength(0)
    expect(mockCoverageRows.find((row) => row.channel === "TCT" && row.product === "diesel")?.status).toBe("failed")
  })

  it("deja intacto un lote existente cuando falla la validación del archivo", async () => {
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({
      rows: [row("AAA"), row("BBB")],
      errors: [{ rowIndex: 9, field: "Patente", message: "requerida" }, { rowIndex: 10, field: "Monto ($)", message: "requerido" }],
      duplicates: [],
      detail: [],
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

    expect(mockTxUpdateSet).not.toHaveBeenCalled()
    expect(mockConsumptionFindMany).not.toHaveBeenCalled()
    expect(mockCoverageRows.find((row) => row.channel === "TCT" && row.product === "diesel")?.status).toBe("failed")
  })

  it("re-imports only the newly-linked plates into an existing batch (no duplicates)", async () => {
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    // El archivo trae AAA (ya importada antes) y BBB (recién vinculada a un vehículo).
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA"), row("BBB")], errors: [], duplicates: [], detail: []  })
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
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [], detail: []  })
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
  it("no arrastra las patentes pendientes de corridas anteriores ni las cuenta dos veces", async () => {
    // El set se sembraba con el estado guardado y sólo hacía `add`: ninguna
    // patente salía nunca, ni al dar de alta el vehículo. El JSON crecía sin
    // techo y `rowsPending` sumaba el histórico completo en CADA corrida, con
    // lo que el ledger quedaba `partial` para siempre.
    mockSettingFindFirst.mockResolvedValue({
      value: JSON.stringify({ cursor: "2026-02-01", taeCursor: null, lastRunAt: null, pending: ["VIEJA1", "VIEJA2", "VIEJA3"] }),
    })
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "informe.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA"), row("SINVEHICULO")], errors: [], duplicates: [], detail: [] })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    // Sólo la patente sin vehículo de ESTE período.
    expect(result.pendingPlates).toEqual(["SINVEHICULO"])
    expect(result.pending).toBe(1)
    // Y no se suma al conteo del ledger: `recordFuelProviderValidation` ya la
    // contó como fila `pending` (el mock devuelve 0 aquí, así que el total
    // refleja exactamente lo que el ledger reportó, sin el set encima).
    expect(result.rowsPending).toBe(0)

    const savedState = JSON.parse(mockSaveState.mock.calls[0]![0].set.value)
    expect(savedState.pending).toEqual(["SINVEHICULO"])
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
      mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [], detail: []  })
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
      expect(JSON.parse(mockSaveState.mock.calls[0]![0].set.value)).toMatchObject({ cursor: "2026-08-01" })
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
      vi.stubEnv("COPEC_SYNC_START_DATE", "2026-08-01")
      mockBatchFindFirst.mockResolvedValue(undefined)
      mockDownloadCopecReports.mockResolvedValue([
        { product: "diesel", unavailable: true },
        { product: "bluemax", unavailable: true },
      ])
      await withToday("2026-08-22T12:00:00.000Z", async () => {
        await expect(syncCopecReports()).resolves.toMatchObject({ imported: 0 })
      })
    })

    it("records the sweep under the operator who pressed «Sincronizar»", async () => {
      // El botón corre el mismo barrido del cron: la corrida queda como manual y
      // a nombre de quien la pidió, no del importador configurado para el cron.
      const { beginFuelProviderSyncRun } = await import("@/lib/combustibles/fuel-provider-ledger")
      vi.mocked(beginFuelProviderSyncRun).mockClear()
      mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2026-08-01", lastRunAt: null, pending: [] }) })
      vi.stubEnv("COPEC_SYNC_START_DATE", "2026-08-01")
      mockBatchFindFirst.mockResolvedValue(undefined)
      mockDownloadCopecReports.mockResolvedValue([
        { product: "diesel", unavailable: true },
        { product: "bluemax", unavailable: true },
      ])
      await withToday("2026-08-22T12:00:00.000Z", async () => {
        await syncCopecReports({ importerId: "operador-1" })
      })
      expect(beginFuelProviderSyncRun).toHaveBeenCalledWith(expect.objectContaining({ trigger: "manual", actorUserId: "operador-1", requestedFrom: "2026-08-01" }))
    })

    it("still fails loudly when a CLOSED month delivers no file", async () => {
      // Ese caso sí indica portal cambiado o credenciales rotas, y enmascararlo
      // fue lo que dejó la sync "al día" con la tabla vacía. Una búsqueda sin
      // resultados (`no_results`) no prueba que el mes esté vacío.
      mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2026-06-01", lastRunAt: null, pending: [] }) })
      vi.stubEnv("COPEC_SYNC_START_DATE", "2026-06-01")
      mockBatchFindFirst.mockResolvedValue(undefined)
      mockDownloadCopecReports.mockResolvedValue([
        { product: "diesel", unavailable: true, reason: "no_results" },
        { product: "bluemax", unavailable: true, reason: "no_results" },
      ])
      await withToday("2026-08-22T12:00:00.000Z", async () => {
        await expect(syncCopecReports()).rejects.toThrow(/no entregó ningún archivo/)
      })
    })

    it("closes a CLOSED month as empty when the portal disables the product, with evidence and the importer as responsible", async () => {
      // El portal deshabilita el producto que la cuenta no tuvo en el mes. Antes
      // quedaba «desconocido» y el mes no avanzaba hasta confirmarlo a mano,
      // todos los meses: TAE BlueMax casi nunca tiene cargas.
      mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2026-06-01", lastRunAt: null, pending: [] }) })
      vi.stubEnv("COPEC_SYNC_START_DATE", "2026-06-01")
      mockBatchFindFirst.mockResolvedValue(undefined)
      mockDownloadCopecReports.mockResolvedValue([
        { product: "diesel", unavailable: true, reason: "product_disabled" },
        { product: "bluemax", unavailable: true, reason: "product_disabled" },
      ])
      mockRecordCopecCoverage.mockClear()
      await withToday("2026-08-22T12:00:00.000Z", async () => {
        await expect(syncCopecReports({ importerId: "operador-1" })).resolves.toMatchObject({ imported: 0 })
      })
      const observations = mockRecordCopecCoverage.mock.calls.map(([observation]) => observation)
      const june = observations.filter((observation) => observation.month === "2026-06-01")
      expect(june).toHaveLength(4)
      expect(june).toEqual(Array.from({ length: 4 }, () => expect.objectContaining({
        status: "legitimate_empty",
        sourceAvailability: "available",
        evidenceActorUserId: "operador-1",
        evidence: expect.stringMatching(/deshabilitado para 2026-06/),
      })))
      // El mes en curso no se cierra así: el producto puede aparecer más adelante.
      const august = observations.filter((observation) => observation.month === "2026-08-01")
      expect(august.length).toBeGreaterThan(0)
      expect(august.every((observation) => observation.status === "unknown")).toBe(true)
    })

    it("closes a CLOSED month as empty when the web service answers «No hay registros»", async () => {
      // Es la misma respuesta de Copec que el producto deshabilitado del portal,
      // dicha en palabras. Un error con `ID_MENSAJE` 0 (rango excedido) llega
      // como falla, no como `no_records`: eso lo cubre `copec-ws.test.ts`.
      mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2026-06-01", lastRunAt: null, pending: [] }) })
      vi.stubEnv("COPEC_SYNC_START_DATE", "2026-06-01")
      mockBatchFindFirst.mockResolvedValue(undefined)
      mockDownloadCopecReports.mockResolvedValue([
        { product: "diesel", unavailable: true, reason: "no_records" },
        { product: "bluemax", unavailable: true, reason: "no_records" },
      ])
      mockRecordCopecCoverage.mockClear()
      await withToday("2026-08-22T12:00:00.000Z", async () => {
        await expect(syncCopecReports({ importerId: "operador-1" })).resolves.toMatchObject({ imported: 0 })
      })
      const june = mockRecordCopecCoverage.mock.calls.map(([observation]) => observation).filter((observation) => observation.month === "2026-06-01")
      expect(june).toHaveLength(4)
      expect(june).toEqual(Array.from({ length: 4 }, () => expect.objectContaining({
        status: "legitimate_empty",
        evidenceActorUserId: "operador-1",
        evidence: expect.stringMatching(/web service de Copec respondió «No hay registros.*en 2026-06/),
      })))
      // El mes en curso sigue abierto: todavía pueden llegar cargas.
      const august = mockRecordCopecCoverage.mock.calls.map(([observation]) => observation).filter((observation) => observation.month === "2026-08-01")
      expect(august.length).toBeGreaterThan(0)
      expect(august.every((observation) => observation.status === "unknown")).toBe(true)
    })
  })

  it("parsea las filas del web service sin leer el buffer y archiva la respuesta tal cual", async () => {
    const { archiveCopecEvidence } = await import("../copec-evidence")
    const records = [{ __row: 1, Patente: "AB-CD12", Volumen: 54.15 }]
    const taeRecords = [{ __row: 1, Tarjeta: "1-000000-00001-9-8" }]
    mockDownloadCopecReports
      .mockResolvedValueOnce([
        { product: "diesel", unavailable: false, report: { buffer: Buffer.from("<soap/>"), fileName: "copec-ws-tct-diesel-2026-02.xml", contentType: "text/xml", records } },
        { product: "bluemax", unavailable: true, reason: "no_records" },
      ])
      .mockResolvedValueOnce([
        { product: "diesel", unavailable: false, report: { buffer: Buffer.from("<soap/>"), fileName: "copec-ws-tae-diesel-2026-02.xml", contentType: "text/xml", records: taeRecords } },
        { product: "bluemax", unavailable: true, reason: "no_records" },
      ])
    mockParseCopecDetail.mockReturnValue({ rows: [{ rowIndex: 1, patente: "AB-CD12", numeroTarjetas: 1, numeroTransacciones: 1, cantidadUnidad: 54.15, monto: 52142, rendimientoPromedio: 0, rawRow: {} }], errors: [], duplicates: [], detail: [], transactions: [] })
    mockParseTaeReceiptRecords.mockReturnValue({ rows: [], errors: [] })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-1", plate: "ABCD12", worksiteId: "W1" }])

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    expect(mockParseConsumptionExcel).not.toHaveBeenCalled()
    expect(mockParseCopecDetail).toHaveBeenCalledWith(records, { expectedProduct: "diesel", period: { from: "2026-02-01", to: "2026-02-28" } })
    expect(mockParseTaeReceiptExcel).not.toHaveBeenCalled()
    expect(mockParseTaeReceiptRecords).toHaveBeenCalledWith(taeRecords, { from: "2026-02-01", to: "2026-02-28", expectedProduct: "diesel" })
    expect(vi.mocked(archiveCopecEvidence).mock.calls.map(([, , format]) => format)).toEqual(["xml", "xml"])
    const versions = mockRecordCopecCoverage.mock.calls.map(([observation]) => (observation as { parserVersion?: string }).parserVersion).filter(Boolean)
    expect(versions.length).toBeGreaterThan(0)
    expect(new Set(versions)).toEqual(new Set(["copec-ws-v1"]))
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
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA")], errors: [], duplicates: [], detail: []  })
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

  it("importa las patentes vinculadas aunque otra del archivo no tenga vehículo", async () => {
    // Antes una sola fila `pending` detenía el producto completo del mes: un
    // equipo nuevo dejaba sin consumos Diésel a todas las faenas.
    const { recordFuelProviderValidation } = await import("../fuel-provider-ledger")
    vi.mocked(recordFuelProviderValidation).mockResolvedValueOnce({ accepted: 2, rejected: 0, pending: 1 } as never)
    const row = (patente: string): unknown => ({ rowIndex: 1, patente, numeroTarjetas: 1, numeroTransacciones: 2, cantidadUnidad: 100, monto: 50000, rendimientoPromedio: 3, rawRow: {} })
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tct-diesel.xlsx" } },
      { product: "bluemax", unavailable: true },
    ])
    mockParseConsumptionExcel.mockResolvedValue({ rows: [row("AAA"), row("SINVEHICULO")], errors: [], duplicates: [], detail: [] })
    mockVehiclesFindMany.mockResolvedValue([{ id: "v-aaa", plate: "AAA", worksiteId: "W1" }])
    const tx = makeTx()
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))

    const result = await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    expect(tx._insertedRecords.map((record) => record.patente)).toEqual(["AAA"])
    expect(result.pendingPlates).toEqual(["SINVEHICULO"])
    expect(result.unavailable).toContain("Diesel: asignación histórica pendiente")
    expect(mockCoverageRows.find((item) => item.channel === "TCT" && item.product === "diesel")?.status).toBe("incomplete")
  })

  it("no importa al ciclo físico una recepción TAE que el validador rechazó", async () => {
    const taeRow = (documentNumber: string, liters: number): unknown => ({
      rowIndex: 1, documentNumber, cardNumber: "7001", productId: "fuel-diesel",
      sourceDate: "2026-02-10", occurredAt: "2026-02-10T13:00:00.000Z",
      liters, unitPrice: 1000, amount: liters * 1000, assignment: "", station: "Copec Ruta 5", rawRow: {},
    })
    mockDownloadCopecReports
      .mockResolvedValueOnce([{ product: "diesel", unavailable: true }, { product: "bluemax", unavailable: true }])
      .mockResolvedValueOnce([
        { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tae-diesel.xlsx" } },
        { product: "bluemax", unavailable: true },
      ])
    mockParseTaeReceiptExcel.mockResolvedValue({ rows: [taeRow("G-1", 500), taeRow("G-2", -200)], errors: [] })

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    expect(mockImportTaeReceipts).toHaveBeenCalledOnce()
    const imported = mockImportTaeReceipts.mock.calls[0]![0] as Array<{ documentNumber: string }>
    expect(imported.map((row) => row.documentNumber)).toEqual(["G-1"])
  })

  // 2026-10-30, producción: con las vasijas ya creadas, ninguna recepción TAE se
  // aceptaba en el ledger. El validador entrega la tarjeta en forma compacta
  // (`plateMatchKey`: «12422690023091») y el mapa de estanques usaba la tarjeta
  // tal como la guardó la vasija («1-242269-00230-9-1»): nunca calzaban, la
  // cobertura TAE quedaba incompleta y el barrido no pasaba del mes.
  it("resuelve la vasija de una recepción TAE aunque la tarjeta llegue compacta del validador", async () => {
    const { recordFuelProviderValidation } = await import("../fuel-provider-ledger")
    vi.mocked(recordFuelProviderValidation).mockClear()
    mockStorageLocationsFindMany.mockResolvedValue([{ id: "loc-cholguan", worksiteId: "W-CHO", productId: "fuel-diesel", taeCardNumber: "1-242269-00230-9-1" }])
    mockDownloadCopecReports
      .mockResolvedValueOnce([{ product: "diesel", unavailable: true }, { product: "bluemax", unavailable: true }])
      .mockResolvedValueOnce([
        { product: "diesel", unavailable: false, report: { buffer: Buffer.from("x"), fileName: "tae-diesel.xlsx" } },
        { product: "bluemax", unavailable: true },
      ])
    mockParseTaeReceiptExcel.mockResolvedValue({ rows: [{
      rowIndex: 1, documentNumber: "G-9", cardNumber: "1-242269-00230-9-1", productId: "fuel-diesel",
      sourceDate: "2026-02-10", occurredAt: "2026-02-10T13:00:00.000Z",
      liters: 500, unitPrice: 1000, amount: 500_000, assignment: "CHOLGUAN", station: "Copec Ruta 5", rawRow: {},
    }], errors: [] })

    await syncCopecReportPeriod({ from: "2026-02-01", to: "2026-02-28" }, "operator-1")

    const taeCall = vi.mocked(recordFuelProviderValidation).mock.calls.find(([, validation]) =>
      (validation as { accepted: Array<{ accountKey: string }> }).accepted.some((row) => row.accountKey === "tae:diesel"))
    expect(taeCall).toBeDefined()
    const resolve = taeCall![2] as (input: { plate: string; product: string }) => { storageLocationId?: string; worksiteId?: string }
    expect(resolve({ plate: "12422690023091", product: "diesel" })).toMatchObject({ storageLocationId: "loc-cholguan", worksiteId: "W-CHO" })
  })

  describe("revisión histórica pedida a mano", () => {
    const dimensions = [["TCT", "diesel"], ["TCT", "bluemax"], ["TAE", "diesel"], ["TAE", "bluemax"]] as const
    function closeMonth(month: string) {
      for (const [channel, product] of dimensions) {
        mockCoverageRows.push({ provider: "copec", sourceAccount: `${channel.toLowerCase()}:${product}`, channel, product, periodMonth: month, status: "complete" })
      }
    }

    beforeEach(() => {
      vi.stubEnv("COPEC_SYNC_START_DATE", "2025-11-01")
      closeMonth("2025-11-01")
      closeMonth("2025-12-01")
      closeMonth("2026-01-01")
      // La reverificación del mock vuelve a observar lo mismo: el mes sigue cerrado.
      mockRecordCopecCoverage.mockImplementation(async () => {})
      mockDownloadCopecReports.mockResolvedValue([
        { product: "diesel", unavailable: true },
        { product: "bluemax", unavailable: true },
      ])
    })

    afterEach(() => {
      mockRecordCopecCoverage.mockReset()
    })

    it("avanza la fecha pedida al mes siguiente cuando el mes revisado sigue cerrado", async () => {
      // Sin esto el plan quedaba clavado en el mes pedido y reverificaba los
      // mismos cuatro meses en cada corrida, para siempre.
      mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: null, taeCursor: null, requestedStart: "2025-11-01", lastRunAt: null, pending: [] }), updatedAt: "2026-03-01T00:00:00.000Z" })

      await syncCopecReportPeriod({ from: "2025-11-01", to: "2025-11-30" }, "operator-1")

      expect(JSON.parse(mockSaveState.mock.calls[0]![0].set.value).requestedStart).toBe("2025-12-01")
    })

    it("borra la fecha pedida cuando alcanza al primer mes sin cubrir", async () => {
      mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: null, taeCursor: null, requestedStart: "2026-01-01", lastRunAt: null, pending: [] }), updatedAt: "2026-03-01T00:00:00.000Z" })

      await syncCopecReportPeriod({ from: "2026-01-01", to: "2026-01-31" }, "operator-1")

      const saved = mockSaveState.mock.calls[0]![0].set.value as string
      expect(JSON.parse(saved).requestedStart).toBeNull()
      // Con el estado persistido, el plan retoma el primer mes sin cubrir.
      mockSettingFindFirst.mockResolvedValue({ value: saved, updatedAt: "2026-03-02T12:00:00.000Z" })
      await expect(getCopecSyncPlan()).resolves.toMatchObject({ from: "2026-02-01" })
    })
  })

  it("refresca el mes en curso aunque un mes histórico detenga el barrido", async () => {
    // El plan parte del mes sin cobertura más antiguo y tiene tope de períodos:
    // con un mes viejo atascado, el mes en curso no entraba a ninguna corrida.
    vi.stubEnv("COPEC_SYNC_START_DATE", "2026-01-01")
    vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"))
    mockDownloadCopecReports.mockResolvedValue([
      { product: "diesel", unavailable: true },
      { product: "bluemax", unavailable: true },
    ])

    await expect(syncCopecReports()).rejects.toThrow(/2026-01-01 a 2026-01-31/)

    // Todo el barrido (mes en curso + histórico, TCT y TAE) en UNA sesión del
    // portal: cada sesión es un login, y cada login un correo con código.
    expect(mockPortalSessions).toHaveBeenCalledOnce()
    expect(mockDownloadCopecReports.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(mockDownloadCopecReports.mock.calls[0]![0]).toEqual([
      { product: "diesel", from: "2026-08-01", to: "2026-08-31" },
      { product: "bluemax", from: "2026-08-01", to: "2026-08-31" },
    ])
  })
})

describe("Copec synchronization start date", () => {
  const dimensions = [
    ["TCT", "diesel"], ["TCT", "bluemax"], ["TAE", "diesel"], ["TAE", "bluemax"],
  ] as const

  function setMonthCoverage(month: string, statuses: string[] = ["complete", "complete", "complete", "complete"]) {
    dimensions.forEach(([channel, product], index) => mockCoverageRows.push({
      provider: "copec",
      sourceAccount: `${channel.toLowerCase()}:${product}`,
      channel,
      product,
      periodMonth: month,
      status: statuses[index]!,
    }))
  }

  function seedCoverageBefore(exclusiveMonth: string) {
    const cursor = new Date("2020-01-01T00:00:00.000Z")
    while (cursor.toISOString().slice(0, 10) < exclusiveMonth) {
      setMonthCoverage(cursor.toISOString().slice(0, 10))
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockBatchFindMany.mockResolvedValue([])
    mockCoverageRows.length = 0
    vi.stubEnv("COPEC_SYNC_START_DATE", "2020-01-01")
    mockSettingFindFirst.mockResolvedValue({
      value: JSON.stringify({ cursor: "2020-02-01", lastRunAt: null, pending: [] }),
      updatedAt: "2026-08-30T12:00:00.000Z",
    })
    mockBatchFindFirst.mockResolvedValue({ periodoHasta: "2026-06-30" })
    mockSaveState.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("ignora el cursor legado cuando no existe evidencia de cobertura", async () => {
    mockSettingFindFirst.mockResolvedValue({ value: JSON.stringify({ cursor: "2026-08-01", taeCursor: "2026-08-01", lastRunAt: null, pending: [] }) })
    mockBatchFindFirst.mockResolvedValue(undefined)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"))
    try {
      const plan = await getCopecSyncPlan()
      expect(plan.from).toBe("2020-01-01")
      expect(plan.periods).toHaveLength(4)
      // `to` sigue al recorte: anunciar 2026 con 4 meses planificados mentiría.
      expect(plan.to).toBe("2020-04-30")
      expect(plan.periods.at(-1)).toEqual({ from: "2020-04-01", to: "2020-04-30" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("mantiene abierto el mes cuando falta un solo producto de un canal", async () => {
    seedCoverageBefore("2026-04-01")
    setMonthCoverage("2026-04-01", ["complete", "incomplete", "complete", "complete"])
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"))
    try {
      const plan = await getCopecSyncPlan()
      expect(plan.from).toBe("2026-04-01")
      expect(plan.to).toBe("2026-07-31")
      expect(plan.periods).toHaveLength(4)
      expect(plan.periods[0]).toEqual({ from: "2026-04-01", to: "2026-04-30" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("trata complete y legitimate_empty como terminales, pero no failed o incomplete", async () => {
    seedCoverageBefore("2026-04-01")
    setMonthCoverage("2026-04-01", ["complete", "legitimate_empty", "complete", "complete"])
    setMonthCoverage("2026-05-01", ["complete", "complete", "failed", "complete"])
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"))
    try {
      const plan = await getCopecSyncPlan()
      expect(plan.from).toBe("2026-05-01")
    } finally {
      vi.useRealTimers()
    }
  })

  it("no permite saltar un mes desconocido por ajuste manual", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"))
    try {
      await expect(setCopecSyncStartDate("2020-02-01", "2020-01-01"))
        .rejects.toThrow("No se puede saltar un mes")
      expect(mockSaveState).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("permite solicitar una revisión histórica anterior al primer mes abierto", async () => {
    seedCoverageBefore("2026-07-01")
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"))
    try {
      const result = await setCopecSyncStartDate("2026-04-01", "2026-07-01")
      expect(result.currentStart).toBe("2026-04-01")
      expect(mockSaveState).toHaveBeenCalledOnce()
      const options = await getCopecSyncStartOptions()
      expect(options).toMatchObject({ minimumStart: "2020-01-01", latestImportedUntil: "2026-06-30" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects a stale edit instead of overwriting a newer sync cursor", async () => {
    seedCoverageBefore("2026-07-01")
    await expect(setCopecSyncStartDate("2026-07-01", "2020-01-01"))
      .rejects.toThrow("La sincronización cambió")
    expect(mockSaveState).not.toHaveBeenCalled()
  })

  // CO-026: la comprobación de arriba es a nivel de aplicación (currentStart);
  // esta es la comprobación a nivel de BD (`setWhere` sobre `updatedAt`) que
  // atrapa la carrera cuando DOS escrituras pasan esa comprobación a la vez —
  // sin esto, la segunda pisaba el cursor de la primera en silencio.
  it("rejects the write itself when another process updated the state row concurrently", async () => {
    seedCoverageBefore("2026-07-01")
    mockSaveStateReturning.mockResolvedValueOnce([])

    await expect(setCopecSyncStartDate("2026-06-01", "2026-07-01"))
      .rejects.toThrow("cambió en otra ejecución")
  })
})

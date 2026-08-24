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
vi.mock("@/lib/combustibles/tae-receipts", () => ({
  importTaeReceipts: (...args: unknown[]) => mockImportTaeReceipts(...args),
}))

const { buildCopecSyncPeriods, copecProjectionHash, getCopecSyncPlan, getCopecSyncStartOptions, setCopecSyncStartDate, syncCopecReportPeriod, syncCopecReports } = await import("../copec-sync")
const { AUTOMATED_SOURCES } = await import("../fuel-sources")

/** Junta todos los strings de un objeto SQL de drizzle. El mock de `findFirst`
 *  responde sin mirar el WHERE, así que la única forma de comprobar A QUÉ fuentes
 *  mira un filtro es inspeccionar el filtro mismo, sin acoplarse a la
 *  representación interna de drizzle. */
function collectStrings(value: unknown, seen = new Set<unknown>(), out: string[] = []): string[] {
  if (typeof value === "string") { out.push(value); return out }
  if (!value || typeof value !== "object" || seen.has(value)) return out
  seen.add(value)
  for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, seen, out)
  return out
}

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

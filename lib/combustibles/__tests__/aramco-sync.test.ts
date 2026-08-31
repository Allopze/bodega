import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  today: vi.fn(() => "2026-08-22"),
  readAramcoConfig: vi.fn(),
  authenticateAramco: vi.fn(),
  fetchAramcoMovements: vi.fn(),
  vehiclesFindMany: vi.fn(),
  usersFindFirst: vi.fn(),
  mappingsFindMany: vi.fn(),
  batchFindFirst: vi.fn(),
  batchFindMany: vi.fn(),
  recordsFindMany: vi.fn(),
  recordFuelProviderIssues: vi.fn(),
}))

/** Lo insertado en la corrida, separado por tabla. */
let insertedBatches: Record<string, unknown>[] = []
let insertedRecords: Record<string, unknown>[] = []
let updatedBatches: Record<string, unknown>[] = []
let updatedRecords: Record<string, unknown>[] = []

vi.mock("@/db/schema", () => ({
  fuelConsumptionRecords: { __table: "records" },
  fuelImportBatches: { __table: "batches" },
  fuelVehicles: { __table: "vehicles" },
  fuelProviderMappings: { __table: "mappings" },
  users: { __table: "users" },
}))

function makeTx() {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      fuelImportBatches: { findFirst: (...args: unknown[]) => mocks.batchFindFirst(...args) },
      fuelConsumptionRecords: { findMany: (...args: unknown[]) => mocks.recordsFindMany(...args) },
    },
    // El insert del lote recibe un objeto y el de registros un array: el mock
    // los distingue por tabla, no por la forma del argumento.
    insert: (table: { __table?: string }) => ({
      values: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(payload) ? payload : [payload]
        if (table.__table === "batches") insertedBatches.push(...rows)
        else insertedRecords.push(...rows)
        return Promise.resolve(undefined)
      },
    }),
    update: (table: { __table?: string }) => ({
      set: (patch: Record<string, unknown>) => {
        if (table.__table === "batches") updatedBatches.push(patch)
        else updatedRecords.push(patch)
        return { where: () => Promise.resolve(undefined) }
      },
    }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  }
}

vi.mock("@/db", () => ({
  db: {
    query: {
      fuelVehicles: { findMany: (...args: unknown[]) => mocks.vehiclesFindMany(...args) },
      users: { findFirst: (...args: unknown[]) => mocks.usersFindFirst(...args) },
      fuelProviderMappings: { findMany: (...args: unknown[]) => mocks.mappingsFindMany(...args) },
      // Usado por el barrido de lotes que la fuente ya no respalda.
      fuelImportBatches: { findMany: (...args: unknown[]) => mocks.batchFindMany(...args) },
    },
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve(undefined) }) }),
    transaction: (callback: (tx: unknown) => unknown) => callback(makeTx()),
  },
}))
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  todayInChile: () => mocks.today(),
}))
vi.mock("@/lib/combustibles/aramco-settings", () => ({
  readAramcoConfig: (...args: unknown[]) => mocks.readAramcoConfig(...args),
}))
vi.mock("@/lib/combustibles/aramco-client", () => ({
  authenticateAramco: (...args: unknown[]) => mocks.authenticateAramco(...args),
  fetchAramcoMovements: (...args: unknown[]) => mocks.fetchAramcoMovements(...args),
}))
// La conciliación tiene sus propias pruebas contra Postgres; acá se aísla para
// que estos casos sigan midiendo sólo la importación.
vi.mock("@/lib/combustibles/fuel-reconciliation", () => ({
  reconcileFuelProviderRun: vi.fn().mockResolvedValue({ reconciled: 0, matched: 0 }),
}))
vi.mock("@/lib/combustibles/fuel-provider-ledger", () => ({
  beginFuelProviderSyncRun: vi.fn().mockResolvedValue({ id: "run-1", correlationId: "corr-1" }),
  recordFuelProviderValidation: vi.fn().mockResolvedValue({ accepted: 1, rejected: 0, pending: 0 }),
  recordFuelProviderIssues: (...args: unknown[]) => mocks.recordFuelProviderIssues(...args),
  finishFuelProviderSyncRun: vi.fn().mockResolvedValue(undefined),
}))

const { aramcoProjectionHash, syncAramco } = await import("../aramco-sync")
const { AUTOMATED_SOURCES } = await import("../fuel-sources")
const { collectStrings } = await import("./drizzle-filter")

/** Transacción con los campos que el portal entrega de verdad. */
function movement(over: Record<string, unknown> = {}) {
  return {
    transactionId: 1,
    transactionDate: "2026-06-15T10:00:00",
    vehicleRegistrationPlate: "SZ GB 72",
    cardNumber: "9962 4515",
    quantity: 100,
    originalAmount: 60_000,
    totalDiscountAmount: 5_000,
    amountToPay: 55_000,
    productName: "Aramco ProForce Diesel B",
    productId: 6,
    vehicleOdometer: null,
    vehiclePreviousOdometer: null,
    serviceStationName: "CONCEPCION",
    customerCostCenterName: null,
    ...over,
  }
}

describe("syncAramco", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedBatches = []
    insertedRecords = []
    updatedBatches = []
    updatedRecords = []
    mocks.batchFindMany.mockResolvedValue([])
    mocks.recordFuelProviderIssues.mockResolvedValue({ rejected: 0 })
    mocks.today.mockReturnValue("2026-08-22")
    mocks.readAramcoConfig.mockResolvedValue({ documentNumber: "78023530-6", password: "780235", syncEnabled: true, hasCredentials: true })
    mocks.authenticateAramco.mockResolvedValue({ token: "tok", baseUrl: "customers/23645/", systemOperatorId: 23645, customerName: "CHOME" })
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [movement()] })
    // El catálogo guarda la patente sin espacios: el matching es por clave
    // normalizada, igual que en Copec.
    mocks.vehiclesFindMany.mockResolvedValue([{ id: "v-1", plate: "SZGB72", worksiteId: "W1" }])
    mocks.usersFindFirst.mockResolvedValue({ id: "cron-user" })
    mocks.mappingsFindMany.mockResolvedValue([])
    mocks.batchFindFirst.mockResolvedValue(undefined)
    mocks.recordsFindMany.mockResolvedValue([])
    process.env.ARAMCO_SYNC_IMPORTER_EMAIL = "importer@chome.cl"
  })

  it("refuses to run without credentials", async () => {
    mocks.readAramcoConfig.mockResolvedValue({ documentNumber: "", password: "", syncEnabled: true, hasCredentials: false })
    await expect(syncAramco()).rejects.toThrow(/credenciales/i)
    expect(mocks.authenticateAramco).not.toHaveBeenCalled()
  })

  it("charges the amount actually paid, not the list price", async () => {
    // `originalAmount` es precio de lista; `amountToPay` es lo que se cobra ya
    // con el descuento. Usar el primero infla el costo y descuadra el precio
    // por litro contra el portal.
    const result = await syncAramco()
    expect(result.imported).toBe(1)
    expect(insertedRecords[0]).toMatchObject({ monto: 55_000, cantidadUnidad: 100, precioPromedioUnidad: 550 })
    expect(insertedBatches[0]).toMatchObject({ totalMonto: 55_000, totalCantidad: 100 })
  })

  it("discards an implausible odometer reading instead of storing 785 km/L", async () => {
    // Caso real del histórico: la lectura previa está desfasada y el rendimiento
    // sale absurdo. Guardar 0 significa «sin dato» y el promedio ponderado lo
    // ignora, en vez de envenenar los dashboards y el detector de anomalías.
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [
      movement({ vehicleOdometer: "77498", vehiclePreviousOdometer: "43753", quantity: 42.967 }),
    ] })
    await syncAramco()
    expect(insertedRecords[0]).toMatchObject({ rendimientoPromedio: 0 })
  })

  it("keeps a plausible odometer reading", async () => {
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [
      movement({ vehicleOdometer: "1500", vehiclePreviousOdometer: "1000", quantity: 100 }),
    ] })
    await syncAramco()
    expect(insertedRecords[0]).toMatchObject({ rendimientoPromedio: 5 })
  })

  it("aggregates a plate's transactions into one row", async () => {
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [
      movement({ transactionId: 1, quantity: 40, amountToPay: 20_000, cardNumber: "A" }),
      movement({ transactionId: 2, quantity: 60, amountToPay: 30_000, cardNumber: "A" }),
    ] })
    await syncAramco()
    expect(insertedRecords).toHaveLength(1)
    expect(insertedRecords[0]).toMatchObject({
      cantidadUnidad: 100, monto: 50_000, numeroTransacciones: 2, numeroTarjetas: 1,
    })
  })

  it("leaves an unknown plate pending instead of dropping its consumption", async () => {
    mocks.vehiclesFindMany.mockResolvedValue([])
    const result = await syncAramco()
    expect(result.imported).toBe(0)
    expect(result.pendingPlates).toEqual(["SZ GB 72"])
    expect(insertedBatches).toHaveLength(0)
  })

  it("splits diesel and AdBlue into separate batches", async () => {
    // `fuel_consumption_records` no tiene columna de producto: el producto vive
    // en `fuente`, así que un producto distinto es un lote distinto.
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [
      movement({ transactionId: 1, productName: "Aramco ProForce Diesel B" }),
      movement({ transactionId: 2, productName: "ADBLUE-FLUA" }),
    ] })
    await syncAramco()
    expect(insertedBatches.map((batch) => batch.fuente).sort())
      .toEqual(["Aramco Fleet AdBlue", "Aramco Fleet Diesel"])
  })

  it("splits calendar months into separate batches", async () => {
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [
      movement({ transactionId: 1, transactionDate: "2026-05-10T08:00:00" }),
      movement({ transactionId: 2, transactionDate: "2026-06-10T08:00:00" }),
    ] })
    await syncAramco()
    expect(insertedBatches.map((batch) => `${batch.periodoDesde}..${batch.periodoHasta}`).sort())
      .toEqual(["2026-05-01..2026-05-31", "2026-06-01..2026-06-30"])
  })

  it("includes the open month so today's consumption is visible", async () => {
    const result = await syncAramco()
    expect(result.to).toBe("2026-08-31")
    const [, to] = mocks.fetchAramcoMovements.mock.calls[0]!.slice(1)
    expect(to).toBe("2026-08-31")
  })

  it("refreshes an open month's totals instead of leaving them stale", async () => {
    // Una patente que ya está en el lote del mes en curso: sus totales cambiaron
    // porque llegó otra carga, así que hay que ACTUALIZARLA. El camino de "sólo
    // patentes que faltaban" la habría dejado con el total viejo.
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [
      movement({ transactionId: 1, transactionDate: "2026-08-02T08:00:00", quantity: 40, amountToPay: 20_000 }),
      movement({ transactionId: 2, transactionDate: "2026-08-09T08:00:00", quantity: 60, amountToPay: 30_000 }),
    ] })
    // Totales viejos: el lote tenía sólo la primera carga.
    mocks.batchFindFirst.mockResolvedValue({ id: "batch-agosto", totalFilas: 1, totalPatentes: 1, totalTarjetas: 1, totalTransacciones: 1, totalCantidad: 40, totalMonto: 20_000 })
    mocks.recordsFindMany.mockResolvedValue([{ id: "rec-1", patente: "SZ GB 72", vehicleId: "v-1" }])

    const result = await syncAramco()

    expect(result.refreshed).toBe(1)
    expect(result.imported).toBe(0)
    expect(updatedRecords[0]).toMatchObject({ cantidadUnidad: 100, monto: 50_000, numeroTransacciones: 2 })
    // Los totales del lote se FIJAN, no se suman: sumar duplicaría lo ya contado.
    expect(updatedBatches[0]).toMatchObject({ totalCantidad: 100, totalMonto: 50_000, totalTransacciones: 2 })
  })

  it("leaves the open month untouched when no new load arrived", async () => {
    // Sin esto, un mes abierto deja `updated_at` nuevo en todos sus registros
    // todos los días aunque nadie haya cargado combustible.
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [movement({ transactionDate: "2026-08-02T08:00:00" })] })
    mocks.batchFindFirst.mockResolvedValue({
      id: "batch-agosto",
      hashArchivo: aramcoProjectionHash([movement({ transactionDate: "2026-08-02T08:00:00" })] as never),
      totalFilas: 1, totalPatentes: 1, totalTarjetas: 1, totalTransacciones: 1,
      totalCantidad: 100, totalMonto: 55_000,
    })

    const result = await syncAramco()

    expect(result).toMatchObject({ imported: 0, refreshed: 0 })
    expect(updatedRecords).toHaveLength(0)
    expect(updatedBatches).toHaveLength(0)
    // Ni siquiera se leen los registros del lote: se corta antes.
    expect(mocks.recordsFindMany).not.toHaveBeenCalled()
  })

  it("never overwrites a manual vehicle link when refreshing", async () => {
    // `linkConsumptionPlateAction` permite vincular una patente a un vehículo
    // cuya patente NO coincide con la del reporte. Ese vínculo no existe en
    // ninguna otra parte: recalcularlo desde el catálogo lo borraría.
    //
    // El "SZ GB 72" del registro guardado es load-bearing: es una fila escrita
    // antes de que Aramco normalizara la patente, y la corrida de hoy emite
    // "SZGB72". Si la proyección volviera a identificar la fila por el texto
    // exacto, esto sería un borrado + inserción y el vínculo se perdería.
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [movement({ transactionDate: "2026-08-02T08:00:00" })] })
    mocks.batchFindFirst.mockResolvedValue({ id: "batch-agosto", totalFilas: 0, totalPatentes: 0, totalTarjetas: 0, totalTransacciones: 0, totalCantidad: 0, totalMonto: 0 })
    mocks.recordsFindMany.mockResolvedValue([{ id: "rec-1", patente: "SZ GB 72", vehicleId: "vehiculo-elegido-a-mano" }])

    await syncAramco()

    expect(updatedRecords[0]).not.toHaveProperty("vehicleId")
  })

  it("adopts the recomputed vehicle for a plate that was still unlinked", async () => {
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [movement({ transactionDate: "2026-08-02T08:00:00" })] })
    mocks.batchFindFirst.mockResolvedValue({ id: "batch-agosto", totalFilas: 0, totalPatentes: 0, totalTarjetas: 0, totalTransacciones: 0, totalCantidad: 0, totalMonto: 0 })
    mocks.recordsFindMany.mockResolvedValue([{ id: "rec-1", patente: "SZ GB 72", vehicleId: null }])

    await syncAramco()

    expect(updatedRecords[0]).toMatchObject({ vehicleId: "v-1" })
  })

  it("still only adds missing plates to a closed month", async () => {
    // Un mes cerrado también se reconstruye si el proveedor cambia el
    // contenido. Esto corrige cargas históricas sin duplicar registros.
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [movement({ transactionDate: "2026-06-15T10:00:00" })] })
    mocks.batchFindFirst.mockResolvedValue({ id: "batch-junio" })
    mocks.recordsFindMany.mockResolvedValue([{ id: "rec-1", patente: "SZ GB 72", vehicleId: "v-1" }])

    const result = await syncAramco()

    expect(result.imported).toBe(0)
    expect(result.refreshed).toBe(1)
    expect(updatedRecords).toHaveLength(1)
  })

  it("re-imports only the plates missing from an existing batch", async () => {
    mocks.fetchAramcoMovements.mockResolvedValue({ issues: [], movements: [
      movement({ transactionId: 1, vehicleRegistrationPlate: "SZ GB 72" }),
      movement({ transactionId: 2, vehicleRegistrationPlate: "RW YH 93" }),
    ] })
    mocks.vehiclesFindMany.mockResolvedValue([
      { id: "v-1", plate: "SZGB72", worksiteId: "W1" },
      { id: "v-2", plate: "RWYH93", worksiteId: "W1" },
    ])
    mocks.batchFindFirst.mockResolvedValue({ id: "batch-existente" })
    mocks.recordsFindMany.mockResolvedValue([{ patente: "SZ GB 72" }])

    const result = await syncAramco()

    expect(result.imported).toBe(1)
    expect(result.batches).toBe(0)
    expect(insertedRecords).toHaveLength(1)
    // Se guarda normalizada: Aramco la entrega "RW YH 93" y el canon del módulo
    // no lleva espacios.
    expect(insertedRecords[0]).toMatchObject({ patente: "RWYH93", batchId: "batch-existente" })
  })

  it("cierra una corrida fallida con las métricas que el ledger ya escribió", async () => {
    // El ledger se escribe ANTES de armar la proyección. Cerrar la corrida con
    // ceros borraba de la bitácora el trabajo que sí quedó hecho.
    const { recordFuelProviderValidation, finishFuelProviderSyncRun } = await import("@/lib/combustibles/fuel-provider-ledger")
    vi.mocked(recordFuelProviderValidation).mockResolvedValue({ accepted: 3, rejected: 1, pending: 2 })
    mocks.batchFindFirst.mockRejectedValue(new Error("la proyección explotó"))

    await expect(syncAramco()).rejects.toThrow("la proyección explotó")

    expect(vi.mocked(finishFuelProviderSyncRun)).toHaveBeenCalledWith("run-1", expect.objectContaining({
      status: "failed",
      rowsAccepted: 3,
      rowsRejected: 1,
      rowsPending: 2,
    }))
  })

  it("el guard de import ajeno excluye a TODOS los proveedores automáticos", async () => {
    // Dos proveedores en la misma faena y mes es el caso normal, no una
    // duplicación: si el guard sólo conociera las fuentes de Aramco, el primer
    // lote de Copec haría que Aramco se saltara esa faena en silencio. Copec ya
    // tiene esta prueba; Aramco no la tenía.
    mocks.batchFindFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ fuente: "Copec" })
    await syncAramco()
    const guardLiterals = collectStrings(mocks.batchFindFirst.mock.calls[1]?.[0])
    expect(AUTOMATED_SOURCES.filter((source) => !guardLiterals.includes(source))).toEqual([])
  })

  it("concilia la corrida y no la marca fallida si la conciliación revienta", async () => {
    // La conciliación es un modelo derivado que se calcula después de importar:
    // los lotes ya están commiteados, así que un fallo ahí es "parcial con
    // motivo", no "la sincronización falló".
    const { reconcileFuelProviderRun } = await import("@/lib/combustibles/fuel-reconciliation")
    const { finishFuelProviderSyncRun } = await import("@/lib/combustibles/fuel-provider-ledger")

    await syncAramco()
    expect(vi.mocked(reconcileFuelProviderRun)).toHaveBeenCalledWith("run-1")

    vi.mocked(reconcileFuelProviderRun).mockRejectedValueOnce(new Error("la conciliación explotó"))
    await syncAramco()

    expect(vi.mocked(finishFuelProviderSyncRun)).toHaveBeenLastCalledWith("run-1", expect.objectContaining({
      status: "partial",
      error: "la conciliación explotó",
    }))
  })

  it("skips a worksite already loaded by hand for that period", async () => {
    // 1ª consulta: no hay lote propio. 2ª: hay una carga manual del período.
    mocks.batchFindFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ fuente: "Aramco" })
    const result = await syncAramco()
    expect(result.imported).toBe(0)
    expect(result.skippedGroups).toEqual([{ periodo: "2026-06", source: "Aramco Fleet Diesel", foreignSource: "Aramco" }])
    expect(insertedBatches).toHaveLength(0)
  })

  it("attributes the batch to the operator on a manual run", async () => {
    await syncAramco({ importerId: "operator-1" })
    expect(insertedBatches[0]).toMatchObject({ importadoPor: "operator-1" })
    // El importador configurado queda para el cron, que no tiene sesión.
    expect(mocks.usersFindFirst).not.toHaveBeenCalled()
  })

  it("fails clearly when the cron has no user to attribute batches to", async () => {
    delete process.env.ARAMCO_SYNC_IMPORTER_EMAIL
    mocks.usersFindFirst.mockResolvedValue(undefined)
    await expect(syncAramco()).rejects.toThrow(/ARAMCO_SYNC_IMPORTER_EMAIL/)
  })

  it("widens the window for an explicit historical range", async () => {
    await syncAramco({ from: "2025-10-01" })
    const [, from, to] = mocks.fetchAramcoMovements.mock.calls[0]!
    expect(from).toBe("2025-10-01")
    // El tope es el fin del mes en curso.
    expect(to).toBe("2026-08-31")
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import ExcelJS from "exceljs"

const mockRequirePermission = vi.fn()
const mockCanAccessWorksite = vi.fn()
const mockIsGlobalRole = vi.fn()
const mockFindFirstBatch = vi.fn()
const mockFindManyFuelVehicles = vi.fn()
const mockTransaction = vi.fn()
const mockRecordAudit = vi.fn()
const mockMkdirp = vi.fn()
const mockWriteBuffer = vi.fn()
const mockRemoveFile = vi.fn()

vi.mock("@/lib/auth/can", () => ({ requirePermission: (...a: unknown[]) => mockRequirePermission(...a) }))
vi.mock("@/lib/auth/scope", () => ({
  canAccessWorksite: (...a: unknown[]) => mockCanAccessWorksite(...a),
  isGlobalRole: (...a: unknown[]) => mockIsGlobalRole(...a),
}))
vi.mock("@/lib/id", () => ({ nanoid: () => "id-new" }))
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => mockRecordAudit(...a) }))
vi.mock("@/lib/storage/helpers", () => ({
  mkdirp: (...a: unknown[]) => mockMkdirp(...a),
  writeBuffer: (...a: unknown[]) => mockWriteBuffer(...a),
  removeFile: (...a: unknown[]) => mockRemoveFile(...a),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({
  db: {
    query: {
      fuelImportBatches: { findFirst: (...a: unknown[]) => mockFindFirstBatch(...a) },
      fuelVehicles: { findMany: (...a: unknown[]) => mockFindManyFuelVehicles(...a) },
    },
    transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}))

// Import after mocks are registered.
const { confirmConsumptionImportAction, previewConsumptionImportAction } = await import("../actions-consumos")

const session = { user: { id: "user-1", email: "u@test.cl", isGlobal: true, worksiteIds: [] as string[], permissions: ["combustibles:import"] } }

async function makeXlsxFile(rows: Record<string, unknown>[], name = "consumos.xlsx") {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Consumos")
  const headers = Object.keys(rows[0] ?? {})
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? null))
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([buffer as unknown as BlobPart], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
}

function makeFormData(file: File, overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("file", file)
  fd.set("worksiteId", overrides.worksiteId ?? "ws-1")
  fd.set("periodoDesde", overrides.periodoDesde ?? "2026-06-01")
  fd.set("periodoHasta", overrides.periodoHasta ?? "2026-06-30")
  fd.set("fuente", overrides.fuente ?? "Copec")
  fd.set("notas", overrides.notas ?? "")
  if (overrides.confirmDuplicates) fd.set("confirmDuplicates", overrides.confirmDuplicates)
  return fd
}

const validRows = [
  { "Patente": "ABCD12", "N° Tarjetas": 1, "N° Transacciones": 5, "Cantidad (Unidad)": 200, "Monto ($)": 180000, "Rendimiento Promedio": 3.2 },
]

function makeTx() {
  const insertedRows: Array<{ values: unknown }> = []
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      fuelVehicles: { findMany: vi.fn().mockResolvedValue([{ id: "veh-1", plate: "ABCD12" }]) },
      // Recheck bajo el lock (CO-026): sin duplicado por defecto, cada test lo
      // sobrescribe cuando quiere ejercitar el camino de duplicado.
      fuelImportBatches: { findFirst: vi.fn().mockResolvedValue(undefined) },
    },
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown) => {
        insertedRows.push({ values: vals })
        return Promise.resolve()
      }),
    })),
    _insertedRows: insertedRows,
  }
  return tx
}

describe("confirmConsumptionImportAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(session)
    mockCanAccessWorksite.mockReturnValue(true)
    mockIsGlobalRole.mockReturnValue(true)
    mockFindFirstBatch.mockResolvedValue(undefined)  // no duplicates by default
    mockFindManyFuelVehicles.mockResolvedValue([{ id: "veh-1", plate: "ABCD12", worksiteId: "ws-1" }])
  })

  it("imports valid rows, matches an existing vehicle by plate, and audits the batch", async () => {
    const tx = makeTx()
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))

    const file = await makeXlsxFile(validRows)
    const res = await confirmConsumptionImportAction(makeFormData(file))

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.imported).toBe(1)
    expect(res.data.errors).toHaveLength(0)
    expect(res.data.batchId).toBe("id-new")

    // Two inserts: the batch row and the consumption records.
    expect(tx.insert).toHaveBeenCalledTimes(2)
    const recordsInsert = tx._insertedRows[1]!.values as Array<{ vehicleId: string | null; patente: string }>
    expect(recordsInsert[0]!.vehicleId).toBe("veh-1")
    expect(recordsInsert[0]!.patente).toBe("ABCD12")

    expect(mockWriteBuffer).toHaveBeenCalledOnce()
    expect(mockRecordAudit).toHaveBeenCalledOnce()
    expect(mockRecordAudit.mock.calls[0]![0]).toMatchObject({ action: "create", entityType: "fuel_import_batch", entityId: "id-new" })
  })

  it("leaves vehicleId null when the plate has no matching fuel vehicle", async () => {
    const tx = makeTx()
    tx.query.fuelVehicles.findMany.mockResolvedValue([])
    mockFindManyFuelVehicles.mockResolvedValue([])
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))

    const file = await makeXlsxFile(validRows)
    const res = await confirmConsumptionImportAction(makeFormData(file))

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const recordsInsert = tx._insertedRows[1]!.values as Array<{ vehicleId: string | null }>
    expect(recordsInsert[0]!.vehicleId).toBeNull()
  })

  it("vincula la patente aunque el catálogo la guarde con guion", async () => {
    // El catálogo guarda "AB-CD12" y la planilla trae "ABCD12". Con `inArray`
    // sobre el texto crudo no calzaban y la fila entraba sin vehículo pese a que
    // el vehículo existe — el mismo bug que las sincronizaciones ya corrigieron.
    const tx = makeTx()
    mockFindManyFuelVehicles.mockResolvedValue([{ id: "veh-1", plate: "AB-CD12", worksiteId: "ws-1" }])
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))

    const file = await makeXlsxFile(validRows)
    const res = await confirmConsumptionImportAction(makeFormData(file, { worksiteId: "ws-1" }))

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const recordsInsert = tx._insertedRows[1]!.values as Array<{ vehicleId: string | null }>
    expect(recordsInsert[0]!.vehicleId).toBe("veh-1")
  })

  it("no elige en silencio cuando dos fichas del catálogo colapsan a la misma patente", async () => {
    // `fuel_vehicles.plate` es único sobre el texto crudo, así que "AB-CD12" y
    // "ABCD12" pueden coexistir. Cuál es la buena es decisión de catálogo.
    const tx = makeTx()
    mockFindManyFuelVehicles.mockResolvedValue([
      { id: "veh-1", plate: "AB-CD12", worksiteId: "ws-1" },
      { id: "veh-2", plate: "ABCD12", worksiteId: "ws-1" },
    ])
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))

    const file = await makeXlsxFile(validRows)
    const res = await confirmConsumptionImportAction(makeFormData(file, { worksiteId: "ws-1" }))

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const recordsInsert = tx._insertedRows[1]!.values as Array<{ vehicleId: string | null }>
    expect(recordsInsert[0]!.vehicleId).toBeNull()
  })

  it("no vincula una patente cuyo vehículo pertenece a otra faena", async () => {
    const tx = makeTx()
    mockFindManyFuelVehicles.mockResolvedValue([{ id: "veh-1", plate: "ABCD12", worksiteId: "ws-2" }])
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))

    const file = await makeXlsxFile(validRows)
    const res = await confirmConsumptionImportAction(makeFormData(file, { worksiteId: "ws-1" }))

    expect(res.ok).toBe(true)
    if (!res.ok) return
    const recordsInsert = tx._insertedRows[1]!.values as Array<{ vehicleId: string | null; worksiteId: string }>
    expect(recordsInsert[0]!.worksiteId).toBe("ws-1")
    expect(recordsInsert[0]!.vehicleId).toBeNull()
  })

  it("imports a first general file into one batch per vehicle worksite", async () => {
    const tx = makeTx()
    tx.query.fuelVehicles.findMany.mockResolvedValue([
      { id: "veh-1", plate: "ABCD12", worksiteId: "ws-1" },
      { id: "veh-2", plate: "EFGH34", worksiteId: "ws-2" },
    ])
    mockFindManyFuelVehicles.mockResolvedValue([
      { id: "veh-1", plate: "ABCD12", worksiteId: "ws-1" },
      { id: "veh-2", plate: "EFGH34", worksiteId: "ws-2" },
    ])
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))
    const file = await makeXlsxFile([
      ...validRows,
      { "Patente": "EFGH34", "N° Tarjetas": 1, "N° Transacciones": 3, "Cantidad (Unidad)": 50, "Monto ($)": 45000, "Rendimiento Promedio": 4.1 },
    ])

    const res = await confirmConsumptionImportAction(makeFormData(file, { worksiteId: "all" }))

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.imported).toBe(2)
    expect(tx.insert).toHaveBeenCalledTimes(4)
    expect(mockRecordAudit).toHaveBeenCalledTimes(2)
  })

  // CO-027: antes una patente sin vehículo en "all" desaparecía con `continue`,
  // sin dejar rastro en ningún lado — ahora vuelve como error visible.
  it("reporta como error una patente sin vehículo en la importación de todas las faenas", async () => {
    const tx = makeTx()
    tx.query.fuelVehicles.findMany.mockResolvedValue([{ id: "veh-1", plate: "ABCD12", worksiteId: "ws-1" }])
    mockFindManyFuelVehicles.mockResolvedValue([{ id: "veh-1", plate: "ABCD12", worksiteId: "ws-1" }])
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))
    const file = await makeXlsxFile([
      ...validRows,
      { "Patente": "SINVEH1", "N° Tarjetas": 1, "N° Transacciones": 2, "Cantidad (Unidad)": 30, "Monto ($)": 27000, "Rendimiento Promedio": 3.0 },
    ])

    const res = await confirmConsumptionImportAction(makeFormData(file, { worksiteId: "all" }))

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.imported).toBe(1)
    expect(res.data.errors).toContainEqual(expect.objectContaining({ field: "PATENTE", message: expect.stringContaining("SINVEH1") }))
  })

  // CO-026: el recheck de duplicado se movió DENTRO de la transacción (bajo el
  // lock), no antes — por eso ahora sí se llama a `db.transaction`, y el
  // archivo ya escrito se compensa al detectar el duplicado bajo el lock.
  it("rejects when the same file was already imported (hash duplicate)", async () => {
    const tx = makeTx()
    tx.query.fuelImportBatches.findFirst.mockResolvedValueOnce({ id: "batch-existing" })
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))

    const file = await makeXlsxFile(validRows)
    const res = await confirmConsumptionImportAction(makeFormData(file))

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toMatch(/ya fue importado/)
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(mockRemoveFile).toHaveBeenCalledOnce()
  })

  it("proceeds past a duplicate when confirmDuplicates=true", async () => {
    const tx = makeTx()
    tx.query.fuelImportBatches.findFirst.mockResolvedValue({ id: "batch-existing" })
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))

    const file = await makeXlsxFile(validRows)
    const res = await confirmConsumptionImportAction(makeFormData(file, { confirmDuplicates: "true" }))

    expect(res.ok).toBe(true)
    expect(mockTransaction).toHaveBeenCalledOnce()
  })

  it("rejects a non-.xlsx file before touching the database", async () => {
    const file = new File(["hola"], "consumos.csv", { type: "text/csv" })
    const res = await confirmConsumptionImportAction(makeFormData(file))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toMatch(/\.xlsx/)
    expect(mockRequirePermission).toHaveBeenCalled()
    expect(mockFindFirstBatch).not.toHaveBeenCalled()
  })

  it("rejects when periodoDesde is after periodoHasta", async () => {
    const file = await makeXlsxFile(validRows)
    const res = await confirmConsumptionImportAction(makeFormData(file, { periodoDesde: "2026-07-01", periodoHasta: "2026-06-01" }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toMatch(/período/)
  })
})

describe("previewConsumptionImportAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(session)
    mockCanAccessWorksite.mockReturnValue(true)
    mockFindFirstBatch.mockResolvedValue(undefined)
  })

  it("does not persist anything and reports matched/unmatched plates", async () => {
    const file = await makeXlsxFile(validRows)
    const res = await previewConsumptionImportAction(makeFormData(file))

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.totales.totalFilas).toBe(1)
    expect(res.data.errores).toHaveLength(0)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockWriteBuffer).not.toHaveBeenCalled()
  })

  it("no cuenta como asociada una patente de otra faena", async () => {
    mockFindManyFuelVehicles.mockResolvedValue([{ id: "veh-1", plate: "ABCD12", worksiteId: "ws-2" }])

    const file = await makeXlsxFile(validRows)
    const res = await previewConsumptionImportAction(makeFormData(file, { worksiteId: "ws-1" }))

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.patentesConVehiculo).toBe(0)
    expect(res.data.patentesSinVehiculo).toBe(1)
  })
})

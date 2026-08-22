import { describe, it, expect, vi, beforeEach } from "vitest"
import ExcelJS from "exceljs"

const mockRequirePermission = vi.fn()
const mockIsGlobalRole = vi.fn()
const mockFindManyWorksites = vi.fn()
const mockFindManyFuelSuppliers = vi.fn()
const mockFindManyFuelVehicles = vi.fn()
const mockTransaction = vi.fn()
const mockRecordAudit = vi.fn()
const mockMkdirp = vi.fn()
const mockWriteBuffer = vi.fn()
const mockRemoveFile = vi.fn()

vi.mock("@/lib/auth/can", () => ({ requirePermission: (...a: unknown[]) => mockRequirePermission(...a) }))
vi.mock("@/lib/auth/scope", () => ({ isGlobalRole: (...a: unknown[]) => mockIsGlobalRole(...a) }))
vi.mock("@/lib/id", () => ({ nanoid: () => "batch-new" }))
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
      worksites: { findMany: (...a: unknown[]) => mockFindManyWorksites(...a) },
      fuelSuppliers: { findMany: (...a: unknown[]) => mockFindManyFuelSuppliers(...a) },
      fuelVehicles: { findMany: (...a: unknown[]) => mockFindManyFuelVehicles(...a) },
    },
    transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}))

const { confirmOperationsImportAction } = await import("../actions-operaciones")

const session = { user: { id: "user-1", email: "u@test.cl", isGlobal: true, worksiteIds: [] as string[], permissions: ["combustibles:import"] } }

async function makeXlsxFile(rows: Record<string, unknown>[], name = "operaciones.xlsx") {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Log")
  const headers = Object.keys(rows[0] ?? {})
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? null))
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([buffer as unknown as BlobPart], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
}

function makeFormData(file: File, overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("file", file)
  if (overrides.confirmDuplicates) fd.set("confirmDuplicates", overrides.confirmDuplicates)
  if (overrides.autoCreateVehicles) fd.set("autoCreateVehicles", overrides.autoCreateVehicles)
  return fd
}

// Sin "Hora Carga": el parser sólo la reconoce cuando la celda es un valor
// Date de Excel (`rawHora instanceof Date`), no un string plano — con un
// string queda `null`, así que se omite para no desalinear operationRowKey.
const validRows = [
  { "Patente": "ABCD12", "Fecha": "2026-06-01", "LT": 50 },
]

function makeTx() {
  const insertedRows: Array<{ table: string; values: unknown }> = []
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      fuelOperationBatches: { findFirst: vi.fn().mockResolvedValue(undefined) },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown) => {
        insertedRows.push({ table: "?", values: vals })
        return Promise.resolve()
      }),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    _insertedRows: insertedRows,
  }
  return tx
}

describe("confirmOperationsImportAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(session)
    mockIsGlobalRole.mockReturnValue(true)
    mockFindManyWorksites.mockResolvedValue([])
    mockFindManyFuelSuppliers.mockResolvedValue([])
    mockFindManyFuelVehicles.mockResolvedValue([{ id: "veh-1", plate: "ABCD12", code: null, type: "camion", brand: null, model: null, year: null }])
  })

  it("imports valid rows, audits within the transaction and writes the file", async () => {
    const tx = makeTx()
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))

    const file = await makeXlsxFile(validRows)
    const res = await confirmOperationsImportAction(makeFormData(file))

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.imported).toBe(1)
    expect(res.data.duplicateRows).toBe(0)
    expect(res.data.batchId).toBe("batch-new")
    expect(mockWriteBuffer).toHaveBeenCalledOnce()
    expect(mockRecordAudit).toHaveBeenCalledOnce()
    expect(mockRecordAudit.mock.calls[0]![0]).toMatchObject({ action: "create", entityType: "fuel_operation_batch" })
    expect(mockRecordAudit.mock.calls[0]![1]).toBe(tx)
    expect(mockRemoveFile).not.toHaveBeenCalled()
  })

  // CO-026: el recheck de duplicado por hash de archivo se movió DENTRO de la
  // transacción, bajo el lock — antes corría antes de escribir el archivo y
  // sin protección de carrera.
  it("rejects a duplicate file hash under the lock and compensates the written file", async () => {
    const tx = makeTx()
    tx.query.fuelOperationBatches.findFirst.mockResolvedValueOnce({ id: "batch-existing" })
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))

    const file = await makeXlsxFile(validRows)
    const res = await confirmOperationsImportAction(makeFormData(file))

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toMatch(/ya fue importado/)
    expect(tx.insert).not.toHaveBeenCalled()
    expect(mockRemoveFile).toHaveBeenCalledOnce()
  })

  // Dedupe secundario por fila (operationRowKey): antes corría fuera de la
  // transacción; ahora se recalcula bajo el mismo lock que el resto (CO-026).
  it("excludes rows that already exist as a real operation record", async () => {
    const tx = makeTx()
    tx.select.mockReturnValue({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { plate: "ABCD12", fecha: "2026-06-01", horaCarga: null, liters: 50, horometro: null },
          ]),
        })),
      })),
    })
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx))

    const file = await makeXlsxFile(validRows)
    const res = await confirmOperationsImportAction(makeFormData(file))

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toMatch(/ya estaban importadas/)
    expect(tx.insert).not.toHaveBeenCalled()
    expect(mockRemoveFile).toHaveBeenCalledOnce()
  })

  it("rejects a non-.xlsx file before touching the database", async () => {
    const file = new File(["hola"], "operaciones.csv", { type: "text/csv" })
    const res = await confirmOperationsImportAction(makeFormData(file))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toMatch(/\.xlsx/)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("requires a global role", async () => {
    mockIsGlobalRole.mockReturnValue(false)
    const file = await makeXlsxFile(validRows)
    const res = await confirmOperationsImportAction(makeFormData(file))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toMatch(/global/)
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { DteBandejaRow } from "../types"

const BASE_ROW: DteBandejaRow = {
  fechaRecepcion: "2026-06-01 09:09",
  estadoPlataforma: "Pendiente de envio a la Plataforma",
  fecha: "2026-06-01",
  tipoDoc: "33",
  folio: 12715,
  rutEmisor: "78023530-6",
  razonSocial: "Proveedor SpA",
  montoTotal: 119000,
  tipoRef: null,
  folioRef: null,
  fechaRef: null,
  nreguist: "9000001",
  pdfUrl: null,
  xmlUrl: null,
}

const mockSyncRunsFindFirst = vi.fn()
const mockDocumentsFindFirst = vi.fn()
const mockInsertValues = vi.fn()
const mockUpdateSet = vi.fn()
const mockTxInsertValues = vi.fn()
const mockTxUpdateSet = vi.fn()
const mockFetchBandejaEntrada = vi.fn()
const mockMatchToPurchaseOrderInvoices = vi.fn()
const mockMatchToFuelLoads = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: {
      dteSyncRuns: { findFirst: (...args: unknown[]) => mockSyncRunsFindFirst(...args) },
      users: { findFirst: vi.fn() },
    },
    insert: () => ({ values: (...args: unknown[]) => mockInsertValues(...args) }),
    update: () => ({ set: (...args: unknown[]) => ({ where: (...whereArgs: unknown[]) => mockUpdateSet(...args, ...whereArgs) }) }),
    transaction: async (cb: (tx: unknown) => unknown) => cb({
      query: { dteDocuments: { findFirst: (...args: unknown[]) => mockDocumentsFindFirst(...args) } },
      insert: () => ({ values: (...args: unknown[]) => mockTxInsertValues(...args) }),
      update: () => ({ set: (...args: unknown[]) => ({ where: (...whereArgs: unknown[]) => mockTxUpdateSet(...args, ...whereArgs) }) }),
    }),
  },
}))
vi.mock("@/db/schema", () => ({
  dteDocuments: {}, dteSyncRuns: {}, users: {},
}))
vi.mock("../bandeja-entrada", () => ({
  fetchBandejaEntrada: (...args: unknown[]) => mockFetchBandejaEntrada(...args),
}))
vi.mock("../reconciliation", () => ({
  matchToPurchaseOrderInvoices: (...args: unknown[]) => mockMatchToPurchaseOrderInvoices(...args),
  matchToFuelLoads: (...args: unknown[]) => mockMatchToFuelLoads(...args),
}))

const { syncDteDocuments, computeDocumentHash } = await import("../sync")
const { DtePortalClient } = await import("../client")

function makeClient() {
  return new DtePortalClient({
    baseUrl: "https://clientes.dtefacturaenlinea.cl/facturaenlinea",
    credentials: { rutUsr: "6466452-2", rutEmp: "78023530-6", clave: "test", codEmp: "433" },
  })
}

describe("computeDocumentHash", () => {
  it("generates deterministic SHA-256 hash for document row", () => {
    const hash1 = computeDocumentHash({ ...BASE_ROW })
    const hash2 = computeDocumentHash({ ...BASE_ROW })

    expect(hash1).toHaveLength(64) // SHA-256 hex
    expect(hash1).toBe(hash2)
  })

  it("produces different hash when document attributes change", () => {
    const updated: DteBandejaRow = { ...BASE_ROW, estadoPlataforma: null }
    expect(computeDocumentHash(BASE_ROW)).not.toBe(computeDocumentHash(updated))
  })

  it("produces different hash for the same folio issued by a different RUT", () => {
    // El folio no es único global; dos proveedores distintos pueden compartir
    // numeración. El hash (y el upsert) deben distinguirlos por RUT.
    const otherSupplier: DteBandejaRow = { ...BASE_ROW, rutEmisor: "11111111-1", razonSocial: "Otro Proveedor" }
    expect(computeDocumentHash(BASE_ROW)).not.toBe(computeDocumentHash(otherSupplier))
  })
})

describe("syncDteDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSet.mockResolvedValue(undefined)
    mockInsertValues.mockResolvedValue(undefined)
    mockTxInsertValues.mockResolvedValue(undefined)
    mockTxUpdateSet.mockResolvedValue(undefined)
    mockMatchToPurchaseOrderInvoices.mockResolvedValue([])
    mockMatchToFuelLoads.mockResolvedValue([])
  })

  it("inserts new documents on first sync (no prior success, no existing rows)", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined) // sin corrida previa exitosa
    mockDocumentsFindFirst.mockResolvedValue(undefined) // ningún documento existe aún
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1 })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(result.rowsSeen).toBe(1)
    expect(result.rowsInserted).toBe(1)
    expect(result.rowsUpdated).toBe(0)
    expect(mockTxInsertValues).toHaveBeenCalledTimes(1)
    expect(mockFetchBandejaEntrada).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mes: "06", anio: "2026", codEmp: "433" }))
  })

  it("is idempotent: re-running with the same data marks documents unchanged, no writes", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1 })
    // Simula que la corrida anterior ya insertó este documento con el mismo hash.
    mockDocumentsFindFirst.mockResolvedValue({ id: "existing-1", rawHash: computeDocumentHash(BASE_ROW) })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", force: true, importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(result.rowsInserted).toBe(0)
    expect(result.rowsUpdated).toBe(0)
    expect(mockTxInsertValues).not.toHaveBeenCalled()
  })

  it("updates the existing document when its hash changed (e.g. estadoPlataforma)", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1 })
    mockDocumentsFindFirst.mockResolvedValue({ id: "existing-1", rawHash: "hash-distinto-de-antes" })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", force: true, importerId: "user-1" })

    expect(result.rowsUpdated).toBe(1)
    expect(result.rowsInserted).toBe(0)
    expect(mockTxUpdateSet).toHaveBeenCalledTimes(1)
  })

  it("skips the sync when a successful run already exists for the period and force is not set", async () => {
    mockSyncRunsFindFirst.mockResolvedValue({ id: "prior-run" })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06" })

    expect(result.status).toBe("skipped")
    expect(result.runId).toBe("prior-run")
    expect(mockFetchBandejaEntrada).not.toHaveBeenCalled()
  })

  it("marks the run partial when some documents fail to upsert", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    const secondRow: DteBandejaRow = { ...BASE_ROW, folio: 99999, rutEmisor: "22222222-2" }
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW, secondRow], totalRegistros: 2 })
    mockDocumentsFindFirst
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("fallo simulado"))

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("partial")
    expect(result.rowsInserted).toBe(1)
    expect(result.error).toContain("1 de 2")
  })

  it("reconciles against OC invoices and fuel loads after closing the run", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1 })

    await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(mockMatchToPurchaseOrderInvoices).toHaveBeenCalledWith("2026-06", "433")
    expect(mockMatchToFuelLoads).toHaveBeenCalledWith("2026-06", "433")
  })

  it("does not let a reconciliation failure change the already-closed sync result", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1 })
    mockMatchToPurchaseOrderInvoices.mockRejectedValue(new Error("fallo de conciliación simulado"))

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(result.rowsInserted).toBe(1)
  })
})

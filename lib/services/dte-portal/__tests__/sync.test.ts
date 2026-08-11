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
const mockClaimDteSyncStart = vi.fn()

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
vi.mock("../sync-start-gate", () => ({
  claimDteSyncStart: (...args: unknown[]) => mockClaimDteSyncStart(...args),
}))

const { syncDteDocuments, computeDocumentHash, previousPeriodo, rollingSyncPeriods, assertSyncablePeriodo } = await import("../sync")
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

describe("previousPeriodo", () => {
  it("retrocede un mes dentro del mismo año", () => {
    expect(previousPeriodo("2026-08")).toBe("2026-07")
  })

  // El caso que rompe cualquier resta ingenua de meses.
  it("cruza el año hacia atrás en enero", () => {
    expect(previousPeriodo("2026-01")).toBe("2025-12")
  })
})

describe("rollingSyncPeriods", () => {
  // Los proveedores entregan con retraso: verificado en producción el
  // 2026-08-11, el portal tenía 578 documentos de julio y la plataforma 575.
  // Sin la ventana, esos 3 eran inalcanzables para siempre.
  it("cubre el mes en curso y el anterior", () => {
    expect(rollingSyncPeriods(new Date(2026, 7, 11))).toEqual(["2026-08", "2026-07"])
  })

  it("cruza el año en enero", () => {
    expect(rollingSyncPeriods(new Date(2026, 0, 3))).toEqual(["2026-01", "2025-12"])
  })
})

describe("assertSyncablePeriodo", () => {
  it("acepta un período válido", () => {
    expect(() => assertSyncablePeriodo("2026-08")).not.toThrow()
  })

  // La validación anterior vivía en la ruta API y comprobaba \d{4}-\d{2},
  // así que estas dos pasaban.
  it.each(["2026-13", "2026-00", "2026-8", "202608", "abcd-ef"])(
    "rechaza el período malformado %s",
    (periodo) => {
      expect(() => assertSyncablePeriodo(periodo)).toThrow(/Período/)
    },
  )

  it("rechaza un período anterior al piso histórico", () => {
    expect(() => assertSyncablePeriodo("1990-01")).toThrow(/mínimo permitido/)
  })

  it("rechaza un período futuro", () => {
    const nextYear = new Date().getFullYear() + 1
    expect(() => assertSyncablePeriodo(`${nextYear}-01`)).toThrow(/futuro/)
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
    mockClaimDteSyncStart.mockResolvedValue({ allowed: true })
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

  it("persists the cron batch correlation id with the DTE run", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [], totalRegistros: 0 })

    const result = await syncDteDocuments(makeClient(), {
      periodo: "2026-06",
      trigger: "cron",
      correlationId: "batch-2026-06",
    })

    expect(result.correlationId).toBe("batch-2026-06")
    expect(mockClaimDteSyncStart).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: "batch-2026-06",
    }))
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

  it("skips the sync for a CLOSED period when a successful run already exists and force is not set", async () => {
    // "2026-06" es un período cerrado frente a cualquier fecha real de
    // ejecución de esta suite: el corte por "ya sincronizado" sólo aplica acá.
    mockSyncRunsFindFirst.mockResolvedValue({ id: "prior-run" })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06" })

    expect(result.status).toBe("skipped")
    expect(result.runId).toBe("prior-run")
    expect(mockFetchBandejaEntrada).not.toHaveBeenCalled()
  })

  it("never skips the CURRENT period, even if a successful run already exists (H-03)", async () => {
    // Antes de H-03, cualquier corrida `success` previa —incluida la del
    // primer día del mes— dejaba el resto del mes sin re-consultar. El mes en
    // curso ni siquiera debe preguntar por una corrida previa.
    mockSyncRunsFindFirst.mockResolvedValue({ id: "prior-run-current-month" })
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1 })

    const currentPeriodo = rollingSyncPeriods()[0]!
    const result = await syncDteDocuments(makeClient(), { periodo: currentPeriodo, importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(mockSyncRunsFindFirst).not.toHaveBeenCalled()
    expect(mockFetchBandejaEntrada).toHaveBeenCalled()
  })

  it("still allows forcing a re-sync of a closed period explicitly", async () => {
    mockSyncRunsFindFirst.mockResolvedValue({ id: "prior-run" })
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1 })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", force: true, importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(mockFetchBandejaEntrada).toHaveBeenCalled()
  })

  it("does not reach the portal when conversion has durably paused new starts", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockClaimDteSyncStart.mockResolvedValue({ allowed: false, reason: "disabled" })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("skipped")
    expect(result.skipReason).toBe("disabled")
    expect(mockFetchBandejaEntrada).not.toHaveBeenCalled()
  })

  it("surfaces a malformed cutover barrier without reaching the portal", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockClaimDteSyncStart.mockResolvedValue({ allowed: false, reason: "invalid_barrier" })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result).toMatchObject({
      status: "skipped",
      skipReason: "invalid_barrier",
      error: "DTE_SETTINGS_BARRIER_INVALID: El cerco de sincronización requiere revisión.",
    })
    expect(mockFetchBandejaEntrada).not.toHaveBeenCalled()
  })

  // H-10 (AUDITORIA_BUGS_2026-08-05.md): sin índice único parcial, el cron y
  // el botón de administración disparándose a la vez raspaban el portal dos
  // veces y la segunda contabilizaba fallos falsos al chocar con
  // `dte_documents_unique_key`.
  it("skips instead of scraping twice when another run is already active", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockClaimDteSyncStart.mockResolvedValue({ allowed: false, reason: "active_run" })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("skipped")
    expect(result.skipReason).toBe("active_run")
    expect(result.error).toMatch(/en curso/i)
    expect(mockFetchBandejaEntrada).not.toHaveBeenCalled()
  })

  it("propagates a real database failure instead of reporting it as 'already running'", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockClaimDteSyncStart.mockRejectedValueOnce(new Error("connection terminated unexpectedly"))

    await expect(syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" }))
      .rejects.toThrow(/connection terminated/i)
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

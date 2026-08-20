import { describe, it, expect, vi, beforeEach } from "vitest"
import type { DteBandejaRow } from "../types"

const BASE_ROW: DteBandejaRow = {
  fechaRecepcion: "2026-06-01 09:09",
  fechaRecepcionDate: "2026-06-01",
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
const mockDocumentsFindMany = vi.fn()
const mockInsertValues = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateReturning = vi.fn()
const mockTxInsertValues = vi.fn()
const mockTxUpdateSet = vi.fn()
const mockFetchBandejaEntrada = vi.fn()
const mockMatchToPurchaseOrderInvoices = vi.fn()
const mockMatchToFuelLoads = vi.fn()
const mockSummarizeDteReconciliation = vi.fn()
const mockClaimDteSyncStart = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: {
      dteSyncRuns: { findFirst: (...args: unknown[]) => mockSyncRunsFindFirst(...args) },
      users: { findFirst: vi.fn() },
    },
    insert: () => ({ values: (...args: unknown[]) => mockInsertValues(...args) }),
    update: () => ({ set: (...args: unknown[]) => ({ where: (...whereArgs: unknown[]) => {
      const applied = Promise.resolve(mockUpdateSet(...args, ...whereArgs))
      return Object.assign(applied, { returning: () => applied.then(() => mockUpdateReturning()) })
    } }) }),
    transaction: async (cb: (tx: unknown) => unknown) => cb({
      query: { dteDocuments: {
        findFirst: (...args: unknown[]) => mockDocumentsFindFirst(...args),
        findMany: (...args: unknown[]) => mockDocumentsFindMany(...args),
      } },
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
  summarizeDteReconciliation: (...args: unknown[]) => mockSummarizeDteReconciliation(...args),
}))
vi.mock("../sync-start-gate", () => ({
  claimDteSyncStart: (...args: unknown[]) => mockClaimDteSyncStart(...args),
}))

const { syncDteDocuments, computeDocumentHash, previousPeriodo, rollingSyncPeriods, recoverySweepPeriods, assertSyncablePeriodo } = await import("../sync")
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
    mockDocumentsFindMany.mockResolvedValue([])
    mockMatchToPurchaseOrderInvoices.mockResolvedValue([])
    mockMatchToFuelLoads.mockResolvedValue([])
    mockSummarizeDteReconciliation.mockResolvedValue({ matched: 0, ambiguous: 0, unmatched: 0, internalAmbiguity: 0, discrepancies: 0 })
    mockClaimDteSyncStart.mockResolvedValue({ allowed: true })
    mockUpdateReturning.mockReturnValue([{ id: "run-1" }])
  })

  it("inserts new documents on first sync (no prior success, no existing rows)", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined) // sin corrida previa exitosa
    mockDocumentsFindFirst.mockResolvedValue(undefined) // ningún documento existe aún
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(result.rowsSeen).toBe(1)
    expect(result.rowsInserted).toBe(1)
    expect(result.rowsUpdated).toBe(0)
    expect(mockTxInsertValues).toHaveBeenCalledTimes(1)
    expect(mockTxInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      portalRecordId: "9000001",
    }))
    expect(mockFetchBandejaEntrada).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mes: "06", anio: "2026", codEmp: "433" }),
      expect.objectContaining({ periodo: "2026-06" }),
    )
  })

  it("persists the cron batch correlation id with the DTE run", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [], totalRegistros: 0, declaredTotal: 0 })

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
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })
    // Simula que la corrida anterior ya insertó este documento con el mismo hash.
    mockDocumentsFindFirst.mockResolvedValue({
      id: "existing-1",
      rawHash: computeDocumentHash(BASE_ROW),
      portalRecordId: BASE_ROW.nreguist,
      fechaRecepcion: BASE_ROW.fechaRecepcionDate,
    })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", force: true, importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(result.rowsInserted).toBe(0)
    expect(result.rowsUpdated).toBe(0)
    expect(mockTxInsertValues).not.toHaveBeenCalled()
  })

  it("backfills the portal record id even when the document hash did not change", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })
    mockDocumentsFindFirst.mockResolvedValue({
      id: "existing-1",
      rawHash: computeDocumentHash(BASE_ROW),
      portalRecordId: null,
    })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", force: true, importerId: "user-1" })

    expect(result.rowsUpdated).toBe(1)
    expect(mockTxUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ portalRecordId: "9000001" }),
      expect.anything(),
    )
  })

  it("updates the existing document when its hash changed (e.g. estadoPlataforma)", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })
    mockDocumentsFindFirst.mockResolvedValue({ id: "existing-1", rawHash: "hash-distinto-de-antes" })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", force: true, importerId: "user-1" })

    expect(result.rowsUpdated).toBe(1)
    expect(result.rowsInserted).toBe(0)
    expect(mockTxUpdateSet).toHaveBeenCalledTimes(1)
  })

  it("updates tax identity fields together with a changed raw hash", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    const changed: DteBandejaRow = {
      ...BASE_ROW,
      razonSocial: "Proveedor Renombrado SpA",
      fecha: "2026-06-02",
    }
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [changed], totalRegistros: 1, declaredTotal: 1 })
    mockDocumentsFindFirst.mockResolvedValue({ id: "existing-1", rawHash: "hash-antiguo", portalRecordId: changed.nreguist })

    await syncDteDocuments(makeClient(), { periodo: "2026-06", force: true, importerId: "user-1" })

    expect(mockTxUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ razonSocialEmisor: "Proveedor Renombrado SpA", fechaEmision: "2026-06-02" }),
      expect.anything(),
    )
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
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })

    const currentPeriodo = rollingSyncPeriods()[0]!
    const result = await syncDteDocuments(makeClient(), { periodo: currentPeriodo, importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(mockSyncRunsFindFirst).not.toHaveBeenCalled()
    expect(mockFetchBandejaEntrada).toHaveBeenCalled()
  })

  it("still allows forcing a re-sync of a closed period explicitly", async () => {
    mockSyncRunsFindFirst.mockResolvedValue({ id: "prior-run" })
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })

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
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW, secondRow], totalRegistros: 2, declaredTotal: 2 })
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
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })

    await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(mockMatchToPurchaseOrderInvoices).toHaveBeenCalledWith("2026-06", "433")
    expect(mockMatchToFuelLoads).toHaveBeenCalledWith("2026-06", "433")
  })

  it("does not let a reconciliation failure change the already-closed sync result", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })
    mockMatchToPurchaseOrderInvoices.mockRejectedValue(new Error("fallo de conciliación simulado"))

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(result.reconciliationStatus).toBe("failed")
    expect(result.rowsInserted).toBe(1)
  })

  it("keeps successful ingestion separate from a partial reconciliation", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })
    mockSummarizeDteReconciliation.mockResolvedValue({ matched: 1, ambiguous: 1, unmatched: 1, discrepancies: 0 })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(result.reconciliationStatus).toBe("partial")
    expect(result.reconciliationError).toMatch(/ambiguas/i)
    expect(mockUpdateSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "success", reconciliationStatus: "partial" }),
      expect.anything(),
    )
  })

  // Los DTE sin vínculo son inventario de trabajo (gastos sin OC, documentos
  // que llegan antes que la factura de Compras): contarlos como problema dejaba
  // la conciliación en "partial" para siempre y la salud DTE nunca volvía a
  // "healthy".
  it("no marca la conciliación parcial cuando lo único pendiente son DTE sin vínculo", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })
    mockSummarizeDteReconciliation.mockResolvedValue({ matched: 10, ambiguous: 0, unmatched: 41, discrepancies: 0 })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.reconciliationStatus).toBe("success")
    expect(result.reconciliationError).toBeUndefined()
    expect(result.reconciliation.unmatched).toBe(41)
  })

  it("distingue por código una ingesta incompleta de una conciliación pendiente", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 3, declaredTotal: 3 })
    mockSummarizeDteReconciliation.mockResolvedValue({ matched: 0, ambiguous: 1, unmatched: 0, discrepancies: 0 })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("partial")
    expect(result.error).toContain("DTE_INGEST_PARTIAL:")
    expect(result.error).toContain("DTE_RECONCILIATION_PENDING:")
  })

  it("no resucita a success una corrida que el barrido de colgadas ya declaró muerta", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })
    mockUpdateReturning.mockReturnValue([]) // la fila ya no está en `running`

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("failed")
    expect(result.error).toContain("DTE_SYNC_RUN_PREEMPTED")
  })

  it("persiste el RUT emisor canónico aunque el portal lo entregue con puntos", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({
      rows: [{ ...BASE_ROW, rutEmisor: "96.542.490-3" }],
      totalRegistros: 1,
      declaredTotal: 1,
    })

    await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(mockTxInsertValues).toHaveBeenCalledWith(expect.objectContaining({ rutEmisor: "96542490-3" }))
  })

  // ORQ-01: sin total declarado, `totalRegistros` se rellena con `rows.length` y
  // compararlos es una tautología. La corrida no puede cerrarse en `success`
  // diciendo que el libro está completo cuando nadie pudo verificarlo.
  it("cierra la corrida como parcial cuando el portal no declara el total de registros", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: null })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("partial")
    expect(result.error).toContain("DTE_INGEST_PARTIAL:")
    expect(result.error).toMatch(/no declaró el total/i)
    expect(result.rowsInserted).toBe(1) // los documentos leídos sí se persisten
  })

  it("usa el total declarado —no el rellenado— para el descuadre de completitud", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 4 })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("partial")
    expect(result.error).toContain("faltan 3")
  })

  // ORQ-03: sin el correlationId, un `partial` que dice "faltan 3" deja tres
  // warns sueltos en stdout sin forma de atribuirlos a esta corrida.
  it("propaga el correlationId y el período al parser de la bandeja", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })

    await syncDteDocuments(makeClient(), { periodo: "2026-06", correlationId: "batch-77", importerId: "user-1" })

    expect(mockFetchBandejaEntrada).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mes: "06" }),
      { correlationId: "batch-77", periodo: "2026-06" },
    )
  })

  // ING-03: la fecha de recepción es lo único que permite medir el atraso del
  // proveedor (la consulta al portal filtra por fecha del documento).
  it("persiste la fecha de recepción del portal", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })

    await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(mockTxInsertValues).toHaveBeenCalledWith(expect.objectContaining({ fechaRecepcion: "2026-06-01" }))
  })

  it("rellena la fecha de recepción en un documento ya sincronizado sin ella", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })
    // Mismo hash: sin el relleno, los documentos históricos nunca la reciben.
    mockDocumentsFindFirst.mockResolvedValue({
      id: "existing-1",
      rawHash: computeDocumentHash(BASE_ROW),
      portalRecordId: BASE_ROW.nreguist,
      fechaRecepcion: null,
    })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", force: true, importerId: "user-1" })

    expect(result.rowsUpdated).toBe(1)
    expect(mockTxUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ fechaRecepcion: "2026-06-01" }),
      expect.anything(),
    )
  })

  // CMP-06: los DTE que el modelo 1:1 no puede vincular (una factura TAE mensual
  // cubre N cargas) NO son un fallo —no entran en `withIssues`— pero sí tienen
  // que quedar dichos en el historial.
  it("informa los DTE sin vínculo por la limitación 1:1 sin ensuciar el estado", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })
    mockSummarizeDteReconciliation.mockResolvedValue({
      matched: 5, ambiguous: 0, unmatched: 2, internalAmbiguity: 7, discrepancies: 0,
    })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.status).toBe("success")
    expect(result.reconciliationStatus).toBe("success")
    expect(result.reconciliationError).toContain("DTE_RECONCILIATION_INFO:")
    expect(result.reconciliationError).toContain("7")
    // La nota es informativa: no puede teñir la columna `error` de la corrida.
    expect(mockUpdateSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "success", reconciliationStatus: "success", error: null }),
      expect.anything(),
    )
  })

  it("suma la nota informativa al motivo cuando la conciliación sí quedó pendiente", async () => {
    mockSyncRunsFindFirst.mockResolvedValue(undefined)
    mockDocumentsFindFirst.mockResolvedValue(undefined)
    mockFetchBandejaEntrada.mockResolvedValue({ rows: [BASE_ROW], totalRegistros: 1, declaredTotal: 1 })
    mockSummarizeDteReconciliation.mockResolvedValue({
      matched: 1, ambiguous: 2, unmatched: 0, internalAmbiguity: 3, discrepancies: 0,
    })

    const result = await syncDteDocuments(makeClient(), { periodo: "2026-06", importerId: "user-1" })

    expect(result.reconciliationStatus).toBe("partial")
    expect(result.reconciliationError).toContain("DTE_RECONCILIATION_PENDING:")
    expect(result.reconciliationError).toMatch(/2 coincidencias ambiguas/)
    expect(result.reconciliationError).toMatch(/3 sin vínculo/)
  })
})

describe("recoverySweepPeriods", () => {
  it("re-consulta los meses recién salidos de la ventana móvil el día 1 por la mañana", () => {
    expect(recoverySweepPeriods(new Date("2026-09-01T12:00:00Z")))
      .toEqual(["2026-07", "2026-06", "2026-05"])
  })

  it("no repite el barrido el resto del mes ni en los slots posteriores del día 1", () => {
    expect(recoverySweepPeriods(new Date("2026-09-15T12:00:00Z"))).toEqual([])
    expect(recoverySweepPeriods(new Date("2026-09-01T23:00:00Z"))).toEqual([])
  })

  it("nunca baja del piso histórico", () => {
    expect(recoverySweepPeriods(new Date("2024-03-01T12:00:00Z"))).toEqual(["2024-01"])
  })
})

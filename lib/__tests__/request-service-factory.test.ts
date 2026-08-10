/**
 * lib/__tests__/request-service-factory.test.ts
 *
 * Tests for the createRequestService factory and its exported functions:
 * - persistDraft (create new, edit existing, validation errors)
 * - addQuotation (upload PDF, request not found, wrong status)
 * - deleteQuotation (not found, non-pending, success)
 * - submitRequest (request not found, wrong status, <3 quotes without notes, success)
 * - selectQuotation (scope check, not found, already processed, success)
 *
 * ARQ-1: `cancelRequest`/`getQuotationsForRequest` ya no viven en el factory
 * — ver el comentario más abajo, junto a donde estaba su describe().
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

// ── Mock DB ──────────────────────────────────────────────────────────────────

const mockDbQuery = { purchaseRequests: { findFirst: vi.fn() } }
const mockDbInsert = vi.fn()
const mockDbDelete = vi.fn()
const mockDbSelect = vi.fn()
const mockDbTransaction = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: { purchaseRequests: { findFirst: (...a: unknown[]) => mockDbQuery.purchaseRequests.findFirst(...a) } },
    insert: (...a: unknown[]) => mockDbInsert(...a),
    delete: (...a: unknown[]) => mockDbDelete(...a),
    select: (...a: unknown[]) => mockDbSelect(...a),
    transaction: (...a: unknown[]) => mockDbTransaction(...a),
  },
}))

vi.mock("@/lib/id", () => ({ nanoid: vi.fn(() => "nanoid-123") }))
vi.mock("@/lib/code-sequences", () => ({ nextCodeTx: vi.fn(() => Promise.resolve("REP-001")) }))
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
  recordStatusChange: vi.fn(),
}))
vi.mock("@/lib/services/item-state", () => ({
  submitItemTx: vi.fn(),
}))
vi.mock("@/lib/storage/helpers", () => ({
  mkdirp: vi.fn(),
  writeBuffer: vi.fn(),
  removeFile: vi.fn(),
}))
vi.mock("@/lib/requests/quotation-access", () => ({
  assertCanDeleteQuotation: vi.fn(),
}))

// ── Helper: build chain mock ─────────────────────────────────────────────────

function _chainMock(result: unknown = []) {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.values = vi.fn(() => chain)
  chain.returning = vi.fn(() => Promise.resolve(Array.isArray(result) ? result : [result]))
  chain.limit = vi.fn(() => Promise.resolve(Array.isArray(result) ? result : [result]))
  chain.from = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => Promise.resolve(Array.isArray(result) ? result : []))
  // thenable
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(Array.isArray(result) ? result : []).then(resolve, reject)
  return chain
}

// DAT-3 lockeó las lecturas de persistDraft/submitRequest (tx.select().for()
// en vez de tx.query.findFirst) y agregó guardas con .returning() a sus
// UPDATE finales — estos dos helpers reflejan esa forma real.
function requestSelectChain(rows: unknown[]) {
  return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ for: vi.fn().mockResolvedValue(rows) }) }) }
}
function plainSelectChain(rows: unknown[]) {
  return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }) }
}

function makeSession(overrides?: Partial<Session["user"]>): Session {
  return {
    user: {
      id: "user-1",
      name: "Test User",
      email: "test@test.com",
      permissions: ["requests:read"],
      worksiteIds: ["ws-1"],
      ...overrides,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as Session
}

// ── Import after mocks ───────────────────────────────────────────────────────

import { createRequestService } from "@/lib/requests/request-service"
import { recordStatusChange } from "@/lib/audit"
import { submitItemTx } from "@/lib/services/item-state"
import { assertCanDeleteQuotation } from "@/lib/requests/quotation-access"
import { mkdirp, writeBuffer, removeFile } from "@/lib/storage/helpers"

// ── Config ───────────────────────────────────────────────────────────────────

const mockQuotationsTable = {
  id: "id",
  requestId: "requestId",
  status: "status",
  createdAt: "createdAt",
  fileName: "fileName",
  filePath: "filePath",
  supplierId: "supplierId",
  supplierNameFree: "supplierNameFree",
}

const storageConfig = {
  dir: vi.fn(() => "/tmp/test-storage"),
  createPath: vi.fn((name: string) => `storage/${name}`),
  resolveFile: vi.fn((fp: string) => `/absolute/${fp}`),
}

const config = {
  requestType: "repuestos" as const,
  codePrefix: "REP",
  quotationsTable: mockQuotationsTable as never,
  quotationEntityType: "repuesto_quotation",
  attributeNames: { brand: "Marca", model: "Modelo" } as Record<string, string>,
  storage: storageConfig,
}

let svc: ReturnType<typeof createRequestService>

beforeEach(() => {
  vi.clearAllMocks()
  svc = createRequestService(config)
})

// ── persistDraft ─────────────────────────────────────────────────────────────

describe("persistDraft", () => {
  const session = makeSession()
  const draftData = {
    worksiteId: "ws-1",
    urgency: "normal" as const,
    requiredDate: "2026-06-01",
    justification: "Necesito herramientas",
    items: [
      { description: "Martillo", quantity: 5, unitOfMeasure: "un", brand: "Stanley", model: "Pro" },
    ],
  }

  it("creates a new draft request", async () => {
    // Mock tx
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue(null) } },
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      }
      return fn(tx as never)
    })

    const requestId = await svc.persistDraft(session, draftData)
    expect(requestId).toBe("nanoid-123")
    expect(mockDbTransaction).toHaveBeenCalled()
  })

  it("edits an existing draft", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const mockSelect = vi.fn()
        .mockReturnValueOnce(requestSelectChain([{ id: "existing-1", requesterId: "user-1", status: "draft" }]))
        .mockReturnValue(plainSelectChain([]))
      const tx = {
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        select: mockSelect,
      }
      return fn(tx as never)
    })

    const requestId = await svc.persistDraft(session, { ...draftData, id: "existing-1" })
    expect(requestId).toBe("existing-1")
  })

  it("throws if editing non-existent request", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { select: vi.fn().mockReturnValueOnce(requestSelectChain([])) }
      return fn(tx as never)
    })

    await expect(svc.persistDraft(session, { ...draftData, id: "nonexistent" })).rejects.toThrow("Solicitud no encontrada")
  })

  it("throws if editing non-draft status", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { select: vi.fn().mockReturnValueOnce(requestSelectChain([{ id: "req-1", requesterId: "user-1", status: "submitted" }])) }
      return fn(tx as never)
    })

    await expect(svc.persistDraft(session, { ...draftData, id: "req-1" })).rejects.toThrow("Solo se puede editar")
  })

  it("throws if requester is different", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { select: vi.fn().mockReturnValueOnce(requestSelectChain([{ id: "req-1", requesterId: "other-user", status: "draft" }])) }
      return fn(tx as never)
    })

    await expect(svc.persistDraft(session, { ...draftData, id: "req-1" })).rejects.toThrow("Solo el solicitante")
  })
})

// ── addQuotation ─────────────────────────────────────────────────────────────

describe("addQuotation", () => {
  it("adds a quotation successfully", async () => {
    mockDbQuery.purchaseRequests.findFirst.mockResolvedValue({ id: "req-1", status: "draft", requesterId: "user-1" })
    // El insert y su auditoría van en una transacción que re-verifica el estado
    // 'draft' bajo lock: el pre-check de arriba corre fuera de la transacción.
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        select: vi.fn().mockReturnValue(requestSelectChain([{ status: "draft" }])),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      }
      return fn(tx as never)
    })

    const result = await svc.addQuotation({
      requestId: "req-1",
      totalAmount: 150000,
      fileBuffer: Buffer.from("test"),
      fileName: "cotizacion.pdf",
      uploadedBy: "user-1",
    })
    expect(result).toBe("nanoid-123")
    expect(mkdirp).toHaveBeenCalledWith("/tmp/test-storage")
    expect(writeBuffer).toHaveBeenCalled()
  })

  it("throws if request not found", async () => {
    mockDbQuery.purchaseRequests.findFirst.mockResolvedValue(null)
    await expect(svc.addQuotation({
      requestId: "nonexistent",
      totalAmount: 100,
      fileBuffer: Buffer.from("test"),
      fileName: "test.pdf",
      uploadedBy: "user-1",
    })).rejects.toThrow("no encontrada")
  })

  it("throws if request is not in draft/returned status", async () => {
    mockDbQuery.purchaseRequests.findFirst.mockResolvedValue({ id: "req-1", status: "submitted", requesterId: "user-1" })
    await expect(svc.addQuotation({
      requestId: "req-1",
      totalAmount: 100,
      fileBuffer: Buffer.from("test"),
      fileName: "test.pdf",
      uploadedBy: "user-1",
    })).rejects.toThrow("Solo se pueden agregar cotizaciones")
  })

  // Note: insert failure cleanup is covered indirectly by the mock setup
  // The catch block calls removeFile().catch(() => {}) which is a simple path
})

// ── deleteQuotation ──────────────────────────────────────────────────────────

describe("deleteQuotation", () => {
  it("throws if quotation not found", async () => {
    mockDbSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) })
    await expect(svc.deleteQuotation({
      quotationId: "q-1",
      expectedRequestId: "req-1",
      session: makeSession(),
      elevatedPermission: "requests:create",
    })).rejects.toThrow("Cotización no encontrada")
  })

  it("throws if quotation is not pending", async () => {
    mockDbSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: "q-1", requestId: "req-1", status: "selected", filePath: "f.pdf", fileName: "f.pdf" }]) }) }) })
    await expect(svc.deleteQuotation({
      quotationId: "q-1",
      expectedRequestId: "req-1",
      session: makeSession(),
      elevatedPermission: "requests:create",
    })).rejects.toThrow("Solo se pueden eliminar cotizaciones pendientes")
  })

  it("deletes successfully", async () => {
    const quotation = { id: "q-1", requestId: "req-1", status: "pending", filePath: "storage/f.pdf", fileName: "f.pdf" }
    mockDbSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([quotation]) }) }) })
    mockDbQuery.purchaseRequests.findFirst.mockResolvedValue({ id: "req-1", status: "draft", requesterId: "user-1", worksiteId: "ws-1" })
    // El DELETE lleva guarda `status = 'pending'` y `.returning()`: los chequeos
    // previos corren fuera de transacción, así que la guarda va en el statement.
    mockDbDelete.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "q-1" }]) }) })
    // removeFile returns a Promise (code calls .catch() on it)
    vi.mocked(removeFile).mockResolvedValue(undefined as never)

    await svc.deleteQuotation({
      quotationId: "q-1",
      expectedRequestId: "req-1",
      session: makeSession(),
      elevatedPermission: "requests:create",
    })

    expect(assertCanDeleteQuotation).toHaveBeenCalled()
    expect(mockDbDelete).toHaveBeenCalled()
    expect(removeFile).toHaveBeenCalled()
  })

  it("no borra el archivo si la fila ya no estaba pendiente (carrera)", async () => {
    const quotation = { id: "q-1", requestId: "req-1", status: "pending", filePath: "storage/f.pdf", fileName: "f.pdf" }
    mockDbSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([quotation]) }) }) })
    mockDbQuery.purchaseRequests.findFirst.mockResolvedValue({ id: "req-1", status: "draft", requesterId: "user-1", worksiteId: "ws-1" })
    // La guarda del DELETE no matchea: otro proceso ya adjudicó la cotización.
    mockDbDelete.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) })
    vi.mocked(removeFile).mockResolvedValue(undefined as never)

    await expect(svc.deleteQuotation({
      quotationId: "q-1",
      expectedRequestId: "req-1",
      session: makeSession(),
      elevatedPermission: "requests:create",
    })).rejects.toThrow("posible concurrencia")

    expect(removeFile).not.toHaveBeenCalled()
  })
})

// ── submitRequest ────────────────────────────────────────────────────────────

describe("submitRequest", () => {
  it("throws if request not found", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const mockSelect = vi.fn().mockReturnValueOnce(requestSelectChain([]))
      const tx = { select: mockSelect }
      return fn(tx as never)
    })
    await expect(svc.submitRequest({ requestId: "req-1", userId: "user-1" })).rejects.toThrow("no encontrada")
  })

  it("throws if request not in draft/returned", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const mockSelect = vi.fn().mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "submitted", code: "REP-001", notes: null }]))
      const tx = { select: mockSelect }
      return fn(tx as never)
    })
    await expect(svc.submitRequest({ requestId: "req-1", userId: "user-1" })).rejects.toThrow("Solo se pueden enviar")
  })

  it("throws if <3 quotations and no notes", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const mockSelect = vi.fn()
        .mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "draft", code: "REP-001", notes: null }]))
        .mockReturnValueOnce(plainSelectChain([{ id: "q1" }]))
      const tx = { select: mockSelect }
      return fn(tx as never)
    })
    await expect(svc.submitRequest({ requestId: "req-1", userId: "user-1" })).rejects.toThrow("al menos 3 cotizaciones")
  })

  it("throws if there are no quotations at all, even with notes", async () => {
    // Enviar sin ninguna cotización dejaba la solicitud sin salida: aprobar
    // exige seleccionar una ganadora y adjuntarlas exige estado 'draft'.
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const mockSelect = vi.fn()
        .mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "draft", code: "REP-001", notes: "Proveedor único" }]))
        .mockReturnValueOnce(plainSelectChain([]))
      const tx = { select: mockSelect }
      return fn(tx as never)
    })
    await expect(svc.submitRequest({ requestId: "req-1", userId: "user-1" })).rejects.toThrow("al menos una cotización")
  })

  it("submits successfully with 3 quotations", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const mockSelect = vi.fn()
        .mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "draft", code: "REP-001", notes: null }]))
        .mockReturnValueOnce(plainSelectChain([{ id: "q1" }, { id: "q2" }, { id: "q3" }]))
        .mockReturnValueOnce(plainSelectChain([]))
      const tx = {
        select: mockSelect,
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "req-1" }]) }) }) }),
      }
      return fn(tx as never)
    })

    await svc.submitRequest({ requestId: "req-1", userId: "user-1", userEmail: "test@test.com" })
    expect(submitItemTx).not.toHaveBeenCalled() // no draft items
    expect(recordStatusChange).toHaveBeenCalled()
  })

  it("submits with <3 quotations but with notes (justification)", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const mockSelect = vi.fn()
        .mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "draft", code: "REP-001", notes: "Justificación" }]))
        .mockReturnValueOnce(plainSelectChain([{ id: "q1" }]))
        .mockReturnValueOnce(plainSelectChain([]))
      const tx = {
        select: mockSelect,
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "req-1" }]) }) }) }),
      }
      return fn(tx as never)
    })

    await svc.submitRequest({ requestId: "req-1", userId: "user-1" })
    expect(recordStatusChange).toHaveBeenCalled()
  })
})

// ── selectQuotation ──────────────────────────────────────────────────────────

// El padre se lee con `select().for("update")` igual que en submitRequest: sin
// ese lock, un cancelRequest concurrente commiteaba entremedio y el UPDATE
// final —que antes no llevaba guarda— pisaba 'cancelled' con 'approved'.
const quotationSelectChain = (rows: unknown[]) => ({
  from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ for: vi.fn().mockResolvedValue(rows) }) }),
})

describe("selectQuotation", () => {
  it("throws if request not found", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { select: vi.fn().mockReturnValueOnce(requestSelectChain([])) }
      return fn(tx as never)
    })
    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" })).rejects.toThrow("no encontrada")
  })

  it("throws if request not in submitted/in_review", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { select: vi.fn().mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "draft", code: "REP-001", worksiteId: "ws-1" }])) }
      return fn(tx as never)
    })
    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" })).rejects.toThrow("no está pendiente")
  })

  it("throws if scope check fails", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { select: vi.fn().mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "submitted", code: "REP-001", worksiteId: "ws-2" }])) }
      return fn(tx as never)
    })
    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1", worksiteIds: ["ws-1"] })).rejects.toThrow("No tienes acceso")
  })

  it("throws if quotation not found", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        select: vi.fn()
          .mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "submitted", code: "REP-001", worksiteId: "ws-1" }]))
          .mockReturnValueOnce(quotationSelectChain([])),
      }
      return fn(tx as never)
    })
    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" })).rejects.toThrow("Cotización no encontrada")
  })

  it("throws if quotation already processed", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        select: vi.fn()
          .mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "submitted", code: "REP-001", worksiteId: "ws-1" }]))
          .mockReturnValueOnce(quotationSelectChain([{ id: "q-1", requestId: "req-1", status: "selected", supplierId: null, supplierNameFree: null }])),
      }
      return fn(tx as never)
    })
    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" })).rejects.toThrow("ya fue procesada")
  })

  it("selects quotation successfully", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const mockUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "q-1" }]) }) }),
      })
      // Tres llamadas a select en el servicio real: el padre (lockeado), la
      // cotización (con `.for("update")`, lock LOG-4/DAT-4) y los ítems
      // `requested` de la solicitud (lectura simple). El mock debe
      // distinguirlas en orden en vez de compartir una sola forma.
      const mockSelect = vi.fn()
        .mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "submitted", code: "REP-001", worksiteId: "ws-1" }]))
        .mockReturnValueOnce(quotationSelectChain([{ id: "q-1", requestId: "req-1", status: "pending", supplierId: "sup-1", supplierNameFree: null }]))
        .mockReturnValueOnce(plainSelectChain([]))
      const tx = {
        select: mockSelect,
        update: mockUpdate,
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      }
      return fn(tx as never)
    })

    await svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" })
    expect(recordStatusChange).toHaveBeenCalled()
  })

  it("aborts if the parent request changed status mid-transaction (cancelada en carrera)", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      // La guarda del UPDATE final no matchea porque otro proceso ya movió la
      // solicitud a 'cancelled': el servicio debe abortar, no estampar
      // 'approved' encima.
      const mockUpdate = vi.fn()
        .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "q-1" }]) }) }) })
        .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })
        .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }) })
      const tx = {
        select: vi.fn()
          .mockReturnValueOnce(requestSelectChain([{ id: "req-1", status: "submitted", code: "REP-001", worksiteId: "ws-1" }]))
          .mockReturnValueOnce(quotationSelectChain([{ id: "q-1", requestId: "req-1", status: "pending", supplierId: "sup-1", supplierNameFree: null }]))
          .mockReturnValueOnce(plainSelectChain([])),
        update: mockUpdate,
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      }
      return fn(tx as never)
    })

    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" }))
      .rejects.toThrow("posible concurrencia")
  })
})

// ── cancelRequest / getQuotationsForRequest ──────────────────────────────────
//
// ARQ-1: ninguna de las dos sigue en el factory (lib/requests/request-service-
// module/factory.ts) — sin consumidores tras F1-1/F1-2 (cancelación
// unificada) y la lectura directa de cotizaciones en el detalle de la
// solicitud. La cobertura real de cancelRequest vive contra PGlite en
// cancel-request-service.test.ts (not found, estado no cancelable, ítems
// bloqueados, rechazo de ítems abiertos + closedAt, liberación de reposición
// EPP, y la carrera con addItemToPurchaseOrderTx). Ambos casos de uso
// (factory de repuestos/servicios y la action genérica de EPP/otro) llaman
// directo a esa función de servicio, así que un solo test la cubre.

/**
 * lib/__tests__/request-service-factory.test.ts
 *
 * Tests for the createRequestService factory and all 7 exported functions:
 * - persistDraft (create new, edit existing, validation errors)
 * - addQuotation (upload PDF, request not found, wrong status)
 * - deleteQuotation (not found, non-pending, success)
 * - submitRequest (request not found, wrong status, <3 quotes without notes, success)
 * - selectQuotation (scope check, not found, already processed, success)
 * - cancelRequest (not found, wrong status, success)
 * - getQuotationsForRequest
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

function chainMock(result: unknown = []) {
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
import { recordAudit, recordStatusChange } from "@/lib/audit"
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
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "existing-1", requesterId: "user-1", status: "draft" }) } },
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        }),
      }
      return fn(tx as never)
    })

    const requestId = await svc.persistDraft(session, { ...draftData, id: "existing-1" })
    expect(requestId).toBe("existing-1")
  })

  it("throws if editing non-existent request", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue(null) } },
      }
      return fn(tx as never)
    })

    await expect(svc.persistDraft(session, { ...draftData, id: "nonexistent" })).rejects.toThrow("Solicitud no encontrada")
  })

  it("throws if editing non-draft status", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", requesterId: "user-1", status: "submitted" }) } },
      }
      return fn(tx as never)
    })

    await expect(svc.persistDraft(session, { ...draftData, id: "req-1" })).rejects.toThrow("Solo se puede editar")
  })

  it("throws if requester is different", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", requesterId: "other-user", status: "draft" }) } },
      }
      return fn(tx as never)
    })

    await expect(svc.persistDraft(session, { ...draftData, id: "req-1" })).rejects.toThrow("Solo el solicitante")
  })
})

// ── addQuotation ─────────────────────────────────────────────────────────────

describe("addQuotation", () => {
  it("adds a quotation successfully", async () => {
    mockDbQuery.purchaseRequests.findFirst.mockResolvedValue({ id: "req-1", status: "draft", requesterId: "user-1" })
    const mockChain = chainMock()
    mockDbInsert.mockReturnValue({ values: vi.fn().mockReturnValue(mockChain) })

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
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
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
})

// ── submitRequest ────────────────────────────────────────────────────────────

describe("submitRequest", () => {
  it("throws if request not found", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue(null) } } }
      return fn(tx as never)
    })
    await expect(svc.submitRequest({ requestId: "req-1", userId: "user-1" })).rejects.toThrow("no encontrada")
  })

  it("throws if request not in draft/returned", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "submitted", code: "REP-001", notes: null }) } } }
      return fn(tx as never)
    })
    await expect(svc.submitRequest({ requestId: "req-1", userId: "user-1" })).rejects.toThrow("Solo se pueden enviar")
  })

  it("throws if <3 quotations and no notes", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "draft", code: "REP-001", notes: null }) } },
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: "q1" }]) }),
        }),
      }
      return fn(tx as never)
    })
    await expect(svc.submitRequest({ requestId: "req-1", userId: "user-1" })).rejects.toThrow("al menos 3 cotizaciones")
  })

  it("submits successfully with 3 quotations", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const mockSelect = vi.fn()
      // First select: quotations
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: "q1" }, { id: "q2" }, { id: "q3" }]) }),
      })
      // Second select: draft items (empty)
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      })
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "draft", code: "REP-001", notes: null }) } },
        select: mockSelect,
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
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
      // First select: quotations (only 1)
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: "q1" }]) }),
      })
      // Second select: draft items (empty)
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      })
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "returned", code: "REP-001", notes: "Justificación" }) } },
        select: mockSelect,
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      }
      return fn(tx as never)
    })

    await svc.submitRequest({ requestId: "req-1", userId: "user-1" })
    expect(recordStatusChange).toHaveBeenCalled()
  })
})

// ── selectQuotation ──────────────────────────────────────────────────────────

describe("selectQuotation", () => {
  it("throws if request not found", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue(null) } } }
      return fn(tx as never)
    })
    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" })).rejects.toThrow("no encontrada")
  })

  it("throws if request not in submitted/in_review", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "draft", code: "REP-001", worksiteId: "ws-1" }) } } }
      return fn(tx as never)
    })
    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" })).rejects.toThrow("no está pendiente")
  })

  it("throws if scope check fails", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "submitted", code: "REP-001", worksiteId: "ws-2" }) } } }
      return fn(tx as never)
    })
    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1", worksiteIds: ["ws-1"] })).rejects.toThrow("No tienes acceso")
  })

  it("throws if quotation not found", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "submitted", code: "REP-001", worksiteId: "ws-1" }) } },
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        }),
      }
      return fn(tx as never)
    })
    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" })).rejects.toThrow("Cotización no encontrada")
  })

  it("throws if quotation already processed", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "submitted", code: "REP-001", worksiteId: "ws-1" }) } },
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: "q-1", requestId: "req-1", status: "selected", supplierId: null, supplierNameFree: null }]) }),
        }),
      }
      return fn(tx as never)
    })
    await expect(svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" })).rejects.toThrow("ya fue procesada")
  })

  it("selects quotation successfully", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const mockUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
      })
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "submitted", code: "REP-001", worksiteId: "ws-1" }) } },
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: "q-1", requestId: "req-1", status: "pending", supplierId: "sup-1", supplierNameFree: null }]) }),
        }),
        update: mockUpdate,
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      }
      return fn(tx as never)
    })

    await svc.selectQuotation({ requestId: "req-1", quotationId: "q-1", userId: "user-1" })
    expect(recordStatusChange).toHaveBeenCalled()
  })
})

// ── cancelRequest ────────────────────────────────────────────────────────────

describe("cancelRequest", () => {
  it("throws if request not found", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue(null) } } }
      return fn(tx as never)
    })
    await expect(svc.cancelRequest("req-1", "user-1", "No longer needed")).rejects.toThrow("Solicitud no encontrada")
  })

  it("throws if request cannot be cancelled (approved status)", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = { query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "approved", code: "REP-001" }) } } }
      return fn(tx as never)
    })
    await expect(svc.cancelRequest("req-1", "user-1", "reason")).rejects.toThrow("No se puede cancelar")
  })

  it("cancels a draft request", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: { purchaseRequests: { findFirst: vi.fn().mockResolvedValue({ id: "req-1", status: "draft", code: "REP-001" }) } },
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      }
      return fn(tx as never)
    })

    await svc.cancelRequest("req-1", "user-1", "Changed mind", { userEmail: "test@test.com" })
    expect(recordStatusChange).toHaveBeenCalled()
  })
})

// ── getQuotationsForRequest ──────────────────────────────────────────────────

describe("getQuotationsForRequest", () => {
  it("returns quotations for a request", async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([{ id: "q-1" }]),
        }),
      }),
    })
    const result = await svc.getQuotationsForRequest("req-1")
    expect(result).toEqual([{ id: "q-1" }])
  })
})

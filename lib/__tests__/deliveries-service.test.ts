/**
 * Unit tests for deliveries service — validation edge cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockTransaction = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: mockTransaction,
  },
}))
vi.mock("@/lib/id", () => ({ nanoid: vi.fn(() => "del-nanoid-123") }))
vi.mock("@/lib/code-sequences", () => ({ nextCodeTx: vi.fn(async () => "ENT-2026-001") }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/services/item-state", () => ({ deliverItemTx: vi.fn() }))
vi.mock("@/lib/services/stock", () => ({ applyMovementTx: vi.fn() }))

import { registerWorkerEppDelivery } from "@/lib/services/deliveries"

describe("registerWorkerEppDelivery — validation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if worksiteId is empty", async () => {
    await expect(registerWorkerEppDelivery({
      worksiteId: "",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("Selecciona una faena")
  })

  it("throws if workerId is empty", async () => {
    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("Selecciona un trabajador")
  })

  it("throws if requestItemId is empty", async () => {
    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("Selecciona un EPP")
  })

  it("throws if quantity is not positive", async () => {
    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 0,
      deliveredBy: "u-1",
    })).rejects.toThrow("mayor a 0")
  })

  it("throws if quantity is negative", async () => {
    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: -1,
      deliveredBy: "u-1",
    })).rejects.toThrow("mayor a 0")
  })

  it("throws if worksiteIds scope check fails", async () => {
    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-other",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    }, ["ws-1"])).rejects.toThrow("acceso")
  })
})

const chainResult = (result: unknown) => {
  const chain: Record<string, unknown> = {}
  const methods = ["from", "where", "limit", "offset", "orderBy", "innerJoin", "leftJoin", "for", "set"]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.limit = vi.fn().mockResolvedValue(result)
  chain.then = (onfulfilled?: (value: unknown) => unknown) => Promise.resolve(result).then(onfulfilled)
  return chain
}

describe("registerWorkerEppDelivery — database transactions", () => {
  beforeEach(() => vi.clearAllMocks())

  it("successfully registers worker EPP delivery", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena 1", isActive: true }),
      },
      workers: {
        findFirst: vi.fn().mockResolvedValue({ id: "w-1", firstName: "Pedro", lastName: "Rojas", isActive: true, worksiteId: "ws-1" }),
      },
      purchaseRequests: {
        findFirst: vi.fn().mockResolvedValue({ id: "req-1", worksiteId: "ws-1" }),
      },
      products: {
        findFirst: vi.fn().mockResolvedValue({ id: "prod-1", name: "EPP Product", isActive: true, isEpp: true }),
      },
      worksiteStock: {
        findFirst: vi.fn().mockResolvedValue({ worksiteId: "ws-1", productId: "prod-1", quantity: 10 }),
      },
    }

    const mockTxSelect = vi.fn()
    const mockTxInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
    const mockTxUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })

    mockTransaction.mockImplementation(async (fn) => fn({
      query: mockTxQuery,
      select: mockTxSelect,
      insert: mockTxInsert,
      update: mockTxUpdate,
    }))

    // locks the request item row
    mockTxSelect.mockReturnValueOnce(chainResult([{ id: "item-1", status: "received", productId: "prod-1", quantity: 2, unitOfMeasure: "unidad" }]))
    // previous deliveries -> returns 0
    mockTxSelect.mockReturnValueOnce(chainResult([]))
    // recibido en faena (LOG-5) -> las 2 unidades ya llegaron
    mockTxSelect.mockReturnValueOnce(chainResult([{ received: 2 }]))

    const result = await registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
      proofAttachment: {
        fileName: "test.pdf",
        filePath: "/path",
        fileSize: 1024,
        mimeType: "application/pdf",
      },
      returnQuantity: 1,
      returnProductId: "prod-old",
      returnReason: "damaged",
    })

    expect(result).toBe("del-nanoid-123")
    expect(mockTxInsert).toHaveBeenCalled()
  })

  it("allows delivering EPP from a partially received request item", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena 1", isActive: true }),
      },
      workers: {
        findFirst: vi.fn().mockResolvedValue({ id: "w-1", firstName: "Pedro", lastName: "Rojas", isActive: true, worksiteId: "ws-1" }),
      },
      purchaseRequests: {
        findFirst: vi.fn().mockResolvedValue({ id: "req-1", worksiteId: "ws-1" }),
      },
      products: {
        findFirst: vi.fn().mockResolvedValue({ id: "prod-1", name: "EPP Product", isActive: true, isEpp: true }),
      },
      worksiteStock: {
        findFirst: vi.fn().mockResolvedValue({ worksiteId: "ws-1", productId: "prod-1", quantity: 4 }),
      },
    }

    const mockTxSelect = vi.fn()
    const mockTxInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
    const mockTxUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })

    mockTransaction.mockImplementation(async (fn) => fn({
      query: mockTxQuery,
      select: mockTxSelect,
      insert: mockTxInsert,
      update: mockTxUpdate,
    }))

    mockTxSelect.mockReturnValueOnce(chainResult([{ id: "item-1", status: "partially_received", productId: "prod-1", requestId: "req-1", quantity: 10, unitOfMeasure: "unidad" }]))
    mockTxSelect.mockReturnValueOnce(chainResult([]))
    // recibido en faena (LOG-5) -> las 10 unidades ya llegaron
    mockTxSelect.mockReturnValueOnce(chainResult([{ received: 10 }]))

    const result = await registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 4,
      deliveredBy: "u-1",
    })

    expect(result).toBe("del-nanoid-123")
    expect(mockTxInsert).toHaveBeenCalled()
  })

  it("throws if worker worksiteId doesn't match delivery worksiteId", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena 1", isActive: true }),
      },
      workers: {
        findFirst: vi.fn().mockResolvedValue({ id: "w-1", firstName: "Pedro", lastName: "Rojas", isActive: true, worksiteId: "ws-other" }),
      },
    }
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery }))
    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("no pertenece")
  })

  it("throws if worker is inactive", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena 1", isActive: true }),
      },
      workers: {
        findFirst: vi.fn().mockResolvedValue({ id: "w-1", isActive: false }),
      },
    }
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery }))
    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("Trabajador no disponible")
  })

  it("throws if request item not found", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena 1", isActive: true }),
      },
      workers: {
        findFirst: vi.fn().mockResolvedValue({ id: "w-1", isActive: true, worksiteId: "ws-1" }),
      },
    }
    const mockTxSelect = vi.fn().mockReturnValue(chainResult([]))
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery, select: mockTxSelect }))

    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("no encontrado")
  })

  it("throws if request item status is invalid", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", isActive: true }),
      },
      workers: {
        findFirst: vi.fn().mockResolvedValue({ id: "w-1", isActive: true, worksiteId: "ws-1" }),
      },
    }
    const mockTxSelect = vi.fn().mockReturnValue(chainResult([{ id: "item-1", status: "draft" }]))
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery, select: mockTxSelect }))

    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("Solo puedes entregar EPP recibidos")
  })

  it("throws if request item is missing productId", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", isActive: true }),
      },
      workers: {
        findFirst: vi.fn().mockResolvedValue({ id: "w-1", isActive: true, worksiteId: "ws-1" }),
      },
    }
    const mockTxSelect = vi.fn().mockReturnValue(chainResult([{ id: "item-1", status: "received", productId: null }]))
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery, select: mockTxSelect }))

    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("no tiene producto de catálogo")
  })

  it("throws if request worksite mismatch", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", isActive: true }),
      },
      workers: {
        findFirst: vi.fn().mockResolvedValue({ id: "w-1", isActive: true, worksiteId: "ws-1" }),
      },
      purchaseRequests: {
        findFirst: vi.fn().mockResolvedValue({ id: "req-1", worksiteId: "ws-other" }),
      },
    }
    const mockTxSelect = vi.fn().mockReturnValue(chainResult([{ id: "item-1", status: "received", productId: "prod-1", requestId: "req-1" }]))
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery, select: mockTxSelect }))

    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("El ítem no pertenece a la faena")
  })

  it("rejects delivery of EPP requested for a different worker", async () => {
    const mockTxQuery = {
      worksites: { findFirst: vi.fn().mockResolvedValue({ id: "ws-1", isActive: true }) },
      workers: { findFirst: vi.fn().mockResolvedValue({ id: "w-2", isActive: true, worksiteId: "ws-1" }) },
    }
    const mockTxSelect = vi.fn().mockReturnValue(chainResult([{
      id: "item-1", status: "received", productId: "prod-1", requestId: "req-1", workerId: "w-1",
    }]))
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery, select: mockTxSelect }))

    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1", workerId: "w-2", requestItemId: "item-1", quantity: 1, deliveredBy: "u-1",
    })).rejects.toThrow("solicitado para otro trabajador")
  })

  it("throws if EPP product is not EPP", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", isActive: true }),
      },
      workers: {
        findFirst: vi.fn().mockResolvedValue({ id: "w-1", isActive: true, worksiteId: "ws-1" }),
      },
      purchaseRequests: {
        findFirst: vi.fn().mockResolvedValue({ id: "req-1", worksiteId: "ws-1" }),
      },
      products: {
        findFirst: vi.fn().mockResolvedValue({ id: "prod-1", isActive: true, isEpp: false }),
      },
    }
    const mockTxSelect = vi.fn().mockReturnValue(chainResult([{ id: "item-1", status: "received", productId: "prod-1", requestId: "req-1" }]))
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery, select: mockTxSelect }))

    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("Solo se pueden entregar productos marcados como EPP")
  })

  it("throws if EPP quantity is insufficient in stock", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", isActive: true }),
      },
      workers: {
        findFirst: vi.fn().mockResolvedValue({ id: "w-1", isActive: true, worksiteId: "ws-1" }),
      },
      purchaseRequests: {
        findFirst: vi.fn().mockResolvedValue({ id: "req-1", worksiteId: "ws-1" }),
      },
      products: {
        findFirst: vi.fn().mockResolvedValue({ id: "prod-1", isActive: true, isEpp: true }),
      },
      worksiteStock: {
        findFirst: vi.fn().mockResolvedValue({ quantity: 0 }),
      },
    }
    const mockTxSelect = vi.fn()
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery, select: mockTxSelect }))

    mockTxSelect.mockReturnValueOnce(chainResult([{ id: "item-1", status: "received", productId: "prod-1", requestId: "req-1", quantity: 5 }]))
    mockTxSelect.mockReturnValueOnce(chainResult([]))
    // recibido en faena (LOG-5) -> alcanza para que el flujo llegue al chequeo de stock
    mockTxSelect.mockReturnValueOnce(chainResult([{ received: 5 }]))

    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("Stock insuficiente")
  })
})

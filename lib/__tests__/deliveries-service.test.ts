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

import { registerWorksiteDelivery, registerWorkerEppDelivery } from "@/lib/services/deliveries"

describe("registerWorksiteDelivery — validation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if worksiteId is empty", async () => {
    await expect(registerWorksiteDelivery({
      worksiteId: "",
      productId: "prod-1",
      quantity: 5,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
    })).rejects.toThrow("Selecciona una faena")
  })

  it("throws if productId is empty", async () => {
    await expect(registerWorksiteDelivery({
      worksiteId: "ws-1",
      productId: "",
      quantity: 5,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
    })).rejects.toThrow("Selecciona un producto")
  })

  it("throws if receiverName is empty", async () => {
    await expect(registerWorksiteDelivery({
      worksiteId: "ws-1",
      productId: "prod-1",
      quantity: 5,
      unitOfMeasure: "unidad",
      receiverName: "  ",
      deliveredBy: "u-1",
    })).rejects.toThrow("quién recibió")
  })

  it("throws if quantity is not positive", async () => {
    await expect(registerWorksiteDelivery({
      worksiteId: "ws-1",
      productId: "prod-1",
      quantity: 0,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
    })).rejects.toThrow("mayor a 0")
  })

  it("throws if quantity is negative", async () => {
    await expect(registerWorksiteDelivery({
      worksiteId: "ws-1",
      productId: "prod-1",
      quantity: -5,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
    })).rejects.toThrow("mayor a 0")
  })

  it("throws if quantity is NaN", async () => {
    await expect(registerWorksiteDelivery({
      worksiteId: "ws-1",
      productId: "prod-1",
      quantity: NaN,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
    })).rejects.toThrow("mayor a 0")
  })

  it("throws if quantity is Infinity", async () => {
    await expect(registerWorksiteDelivery({
      worksiteId: "ws-1",
      productId: "prod-1",
      quantity: Infinity,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
    })).rejects.toThrow("mayor a 0")
  })

  it("throws if worksiteIds scope check fails", async () => {
    await expect(registerWorksiteDelivery({
      worksiteId: "ws-other",
      productId: "prod-1",
      quantity: 5,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
    }, ["ws-1"])).rejects.toThrow("acceso")
  })
})

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

describe("registerWorksiteDelivery — database transactions", () => {
  beforeEach(() => vi.clearAllMocks())

  it("successfully registers worksite delivery", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena 1", isActive: true }),
      },
      products: {
        findFirst: vi.fn().mockResolvedValue({ id: "prod-1", name: "Product 1", isActive: true }),
      },
    }

    const mockTxInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

    mockTransaction.mockImplementation(async (fn) => fn({
      query: mockTxQuery,
      insert: mockTxInsert,
    }))

    const result = await registerWorksiteDelivery({
      worksiteId: "ws-1",
      productId: "prod-1",
      quantity: 5,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
      notes: "some notes",
    })

    expect(result).toBe("del-nanoid-123")
    expect(mockTxInsert).toHaveBeenCalled()
  })

  it("throws if worksite is not active", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena 1", isActive: false }),
      },
      products: {
        findFirst: vi.fn().mockResolvedValue({ id: "prod-1", name: "Product 1", isActive: true }),
      },
    }
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery }))
    await expect(registerWorksiteDelivery({
      worksiteId: "ws-1",
      productId: "prod-1",
      quantity: 5,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
    })).rejects.toThrow("Faena no disponible")
  })

  it("throws if product is not active", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena 1", isActive: true }),
      },
      products: {
        findFirst: vi.fn().mockResolvedValue({ id: "prod-1", name: "Product 1", isActive: false }),
      },
    }
    mockTransaction.mockImplementation(async (fn) => fn({ query: mockTxQuery }))
    await expect(registerWorksiteDelivery({
      worksiteId: "ws-1",
      productId: "prod-1",
      quantity: 5,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
    })).rejects.toThrow("Producto no disponible")
  })

  it("handles requestItemId link and checks remaining balance", async () => {
    const mockTxQuery = {
      worksites: {
        findFirst: vi.fn().mockResolvedValue({ id: "ws-1", name: "Faena 1", isActive: true }),
      },
      products: {
        findFirst: vi.fn().mockResolvedValue({ id: "prod-1", name: "Product 1", isActive: true }),
      },
    }

    const mockTxSelect = vi.fn()
    const mockTxInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })

    mockTransaction.mockImplementation(async (fn) => fn({
      query: mockTxQuery,
      select: mockTxSelect,
      insert: mockTxInsert,
    }))

    // 1st select inside tx: locks the request item row -> returns request item details
    mockTxSelect.mockReturnValueOnce(chainResult([{ id: "item-1", status: "received", productId: "prod-1", quantity: 10 }]))
    // 2nd select inside tx: previous deliveries -> returns 3 already delivered
    mockTxSelect.mockReturnValueOnce(chainResult([{ quantity: 3 }]))

    const result = await registerWorksiteDelivery({
      worksiteId: "ws-1",
      productId: "prod-1",
      requestItemId: "item-1",
      quantity: 5,
      unitOfMeasure: "unidad",
      receiverName: "Juan",
      deliveredBy: "u-1",
    })

    expect(result).toBe("del-nanoid-123")
    expect(mockTxSelect).toHaveBeenCalled()
    expect(mockTxInsert).toHaveBeenCalled()
  })
})

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

    mockTransaction.mockImplementation(async (fn) => fn({
      query: mockTxQuery,
      select: mockTxSelect,
      insert: mockTxInsert,
    }))

    // locks the request item row
    mockTxSelect.mockReturnValueOnce(chainResult([{ id: "item-1", status: "received", productId: "prod-1", quantity: 2, unitOfMeasure: "unidad" }]))
    // previous deliveries -> returns 0
    mockTxSelect.mockReturnValueOnce(chainResult([]))

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

    mockTransaction.mockImplementation(async (fn) => fn({
      query: mockTxQuery,
      select: mockTxSelect,
      insert: mockTxInsert,
    }))

    mockTxSelect.mockReturnValueOnce(chainResult([{ id: "item-1", status: "partially_received", productId: "prod-1", requestId: "req-1", quantity: 10, unitOfMeasure: "unidad" }]))
    mockTxSelect.mockReturnValueOnce(chainResult([]))

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

    await expect(registerWorkerEppDelivery({
      worksiteId: "ws-1",
      workerId: "w-1",
      requestItemId: "item-1",
      quantity: 1,
      deliveredBy: "u-1",
    })).rejects.toThrow("Stock insuficiente")
  })
})

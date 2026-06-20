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

/**
 * Unit tests for receiving service — validation edge cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSelect = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockNanoid = vi.hoisted(() => vi.fn(() => "rec-nanoid-123"))

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    transaction: mockTransaction,
  },
}))
vi.mock("@/lib/id", () => ({ nanoid: mockNanoid }))
vi.mock("@/lib/code-sequences", () => ({ nextCodeTx: vi.fn(async () => "REC-2026-001") }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/services/item-state", () => ({ receiveItemTx: vi.fn() }))
vi.mock("@/lib/services/stock", () => ({ applyMovementTx: vi.fn() }))

import { registerReceipt } from "@/lib/services/receiving"

describe("registerReceipt — validation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("throws if items array is empty", async () => {
    await expect(registerReceipt({
      purchaseOrderId: "oc-1",
      receivedBy: "u-1",
      stage: "office",
      items: [],
    })).rejects.toThrow("At least one received item")
  })

  it("throws if items contain duplicates", async () => {
    await expect(registerReceipt({
      purchaseOrderId: "oc-1",
      receivedBy: "u-1",
      stage: "office",
      items: [
        { purchaseOrderItemId: "item-1", quantityReceived: 5 },
        { purchaseOrderItemId: "item-1", quantityReceived: 3 },
      ],
    })).rejects.toThrow("duplicated")
  })

  it("throws if order not found in transaction", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn(),
        update: vi.fn(),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }
      return fn(tx as unknown as Record<string, unknown>)
    })

    await expect(registerReceipt({
      purchaseOrderId: "oc-nonexistent",
      receivedBy: "u-1",
      stage: "office",
      items: [{ purchaseOrderItemId: "item-1", quantityReceived: 5 }],
    })).rejects.toThrow("not found")
  })

  it("throws if order in wrong status", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn(),
        update: vi.fn(),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([{ id: "oc-1", status: "draft", worksiteId: "ws-1" }]),
            }),
          }),
        }),
      }
      return fn(tx as unknown as Record<string, unknown>)
    })

    await expect(registerReceipt({
      purchaseOrderId: "oc-1",
      receivedBy: "u-1",
      stage: "office",
      items: [{ purchaseOrderItemId: "item-1", quantityReceived: 5 }],
    })).rejects.toThrow("Cannot receive against order")
  })

  it("throws if faena stage when order still sent (not office_received)", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn(),
        update: vi.fn(),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([{ id: "oc-1", status: "sent", worksiteId: "ws-1" }]),
            }),
          }),
        }),
      }
      return fn(tx as unknown as Record<string, unknown>)
    })

    await expect(registerReceipt({
      purchaseOrderId: "oc-1",
      receivedBy: "u-1",
      stage: "faena",
      worksiteId: "ws-1",
      items: [{ purchaseOrderItemId: "item-1", quantityReceived: 5 }],
    })).rejects.toThrow("llegada a oficina")
  })

  it("throws if worksiteIds scope check fails", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn(),
        update: vi.fn(),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([{ id: "oc-1", status: "sent", worksiteId: "ws-other" }]),
            }),
          }),
        }),
      }
      return fn(tx as unknown as Record<string, unknown>)
    })

    await expect(registerReceipt({
      purchaseOrderId: "oc-1",
      receivedBy: "u-1",
      stage: "office",
      items: [{ purchaseOrderItemId: "item-1", quantityReceived: 5 }],
    }, ["ws-1"])).rejects.toThrow("acceso")
  })
})

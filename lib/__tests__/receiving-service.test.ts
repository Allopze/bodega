import { describe, expect, it, vi } from "vitest"
import { registerReceipt, type RegisterReceiptInput } from "@/lib/services/receiving"

// Mock dependencies
const mockSelect = vi.fn()
const mockTransaction = vi.fn()

vi.mock("@/db", () => ({
  db: {
    select: () => mockSelect(),
    transaction: (cb: unknown) => mockTransaction(cb),
  },
}))

describe("Receiving Service (registerReceipt)", () => {
  it("rejects receipt registration with empty items list", async () => {
    const input: RegisterReceiptInput = {
      purchaseOrderId: "po-1",
      receivedBy: "user-1",
      stage: "office",
      items: [],
    }

    await expect(registerReceipt(input, "all")).rejects.toThrow("At least one received item is required")
  })

  it("rejects receipt registration with duplicate purchase order items", async () => {
    const input: RegisterReceiptInput = {
      purchaseOrderId: "po-1",
      receivedBy: "user-1",
      stage: "office",
      items: [
        { purchaseOrderItemId: "item-101", quantityReceived: 5 },
        { purchaseOrderItemId: "item-101", quantityReceived: 3 }, // Duplicado
      ],
    }

    await expect(registerReceipt(input, "all")).rejects.toThrow("Receipt contains duplicated order items")
  })
})

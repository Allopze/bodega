import { describe, expect, it } from "vitest"
import { suggestReceiptLinks } from "./invoice-receipt-suggestions"

const invoice = {
  id: "invoice-1",
  purchaseOrderId: "order-1",
  invoiceNumber: "F-00123",
  issueDate: "2026-08-20",
  items: [{ purchaseOrderItemId: "item-1", quantity: 10 }],
}

describe("suggestReceiptLinks", () => {
  it("prioritizes an exact normalized supplier document number", () => {
    const result = suggestReceiptLinks(invoice, [
      {
        id: "receipt-exact", purchaseOrderId: "order-1", code: "REC-1",
        dispatchGuideNo: "000123", receivedAt: "2026-08-20T12:00:00.000Z",
        items: [{ purchaseOrderItemId: "item-1", quantityReceived: 10 }],
      },
      {
        id: "receipt-other", purchaseOrderId: "order-1", code: "REC-2",
        dispatchGuideNo: "GD-999", receivedAt: "2026-08-20T12:00:00.000Z",
        items: [{ purchaseOrderItemId: "item-1", quantityReceived: 10 }],
      },
    ])

    expect(result).toMatchObject({ receiptIds: ["receipt-exact"], confidence: "high", ambiguous: false })
    expect(result.reasons.join(" ")).toMatch(/número documental/i)
    expect(result.reasons.join(" ")).toMatch(/separadas por 0 día/i)
  })

  it("combines several receipts when their accepted lines cover one invoice", () => {
    const result = suggestReceiptLinks(invoice, [
      {
        id: "receipt-6", purchaseOrderId: "order-1", code: "REC-6",
        dispatchGuideNo: "GD-6", receivedAt: "2026-08-20T12:00:00.000Z",
        items: [{ purchaseOrderItemId: "item-1", quantityReceived: 6 }],
      },
      {
        id: "receipt-4", purchaseOrderId: "order-1", code: "REC-4",
        dispatchGuideNo: "GD-4", receivedAt: "2026-08-21T12:00:00.000Z",
        items: [{ purchaseOrderItemId: "item-1", quantityReceived: 4 }],
      },
    ])

    expect(result).toMatchObject({ receiptIds: ["receipt-6", "receipt-4"], confidence: "medium", ambiguous: false })
    expect(result.reasons.join(" ")).toMatch(/cantidades documentadas/i)
  })

  it("does not choose when two receipts have the same evidence", () => {
    const result = suggestReceiptLinks({ ...invoice, items: [{ purchaseOrderItemId: "item-1", quantity: 5 }] }, [
      {
        id: "receipt-a", purchaseOrderId: "order-1", code: "REC-A",
        dispatchGuideNo: null, receivedAt: "2026-08-20T12:00:00.000Z",
        items: [{ purchaseOrderItemId: "item-1", quantityReceived: 5 }],
      },
      {
        id: "receipt-b", purchaseOrderId: "order-1", code: "REC-B",
        dispatchGuideNo: null, receivedAt: "2026-08-20T12:00:00.000Z",
        items: [{ purchaseOrderItemId: "item-1", quantityReceived: 5 }],
      },
    ])

    expect(result).toMatchObject({ receiptIds: [], confidence: "low", ambiguous: true })
  })

  it("never suggests a receipt from another purchase order", () => {
    const result = suggestReceiptLinks(invoice, [{
      id: "foreign", purchaseOrderId: "order-2", code: "REC-X",
      dispatchGuideNo: "000123", receivedAt: "2026-08-20T12:00:00.000Z",
      items: [{ purchaseOrderItemId: "item-1", quantityReceived: 10 }],
    }])

    expect(result.receiptIds).toEqual([])
  })
})

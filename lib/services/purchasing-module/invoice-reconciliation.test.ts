import { describe, expect, it } from "vitest"
import { reconcileInvoiceEvidence } from "./invoice-reconciliation"

const orderItems = [
  { id: "oc-1", productName: "Casco", quantity: 2 },
  { id: "oc-2", productName: "Guantes", quantity: 4 },
]

describe("reconcileInvoiceEvidence", () => {
  it("keeps money reconciliation separate when invoices have no line evidence", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems,
      invoices: [{ id: "inv-1", invoiceNumber: "123", amount: 100, items: [] }],
    })

    expect(result.money).toMatchObject({ status: "matched", difference: 0 })
    expect(result.lines).toMatchObject({ status: "not_evaluable", invoicesWithoutLines: 1 })
    expect(result.items.every((item) => item.status === "not_evaluable")).toBe(true)
  })

  it("reports mixed linked and unlinked lines as partial even when the total matches", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems,
      invoices: [{
        id: "inv-1",
        invoiceNumber: "123",
        amount: 100,
        items: [
          { purchaseOrderItemId: "oc-1", quantity: 2 },
          { purchaseOrderItemId: null, quantity: 4 },
        ],
      }],
    })

    expect(result.money.status).toBe("matched")
    expect(result.lines).toMatchObject({ status: "partial", unlinkedLineCount: 1 })
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ ocItemId: "oc-1", status: "covered" }),
      expect.objectContaining({ ocItemId: "oc-2", status: "not_covered" }),
    ]))
  })

  it("uses the CLP tolerance of one peso for the monetary axis", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems,
      invoices: [{ id: "inv-1", invoiceNumber: "123", amount: 101, items: [] }],
    })

    expect(result.money.status).toBe("matched")
  })

  it("reports each invoice's line evidence independently", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems,
      invoices: [
        { id: "without-lines", invoiceNumber: "001", amount: 25, items: [] },
        {
          id: "partial", invoiceNumber: "002", amount: 75,
          items: [
            { purchaseOrderItemId: "oc-1", quantity: 2 },
            { purchaseOrderItemId: null, quantity: 1 },
          ],
        },
        {
          id: "linked", invoiceNumber: "003", amount: 0,
          items: [{ purchaseOrderItemId: "oc-2", quantity: 4 }],
        },
      ],
    })

    expect(result.invoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ invoiceId: "without-lines", status: "without_lines" }),
      expect.objectContaining({ invoiceId: "partial", status: "partial", linkedLineCount: 1, unlinkedLineCount: 1 }),
      expect.objectContaining({ invoiceId: "linked", status: "linked_lines" }),
    ]))
  })
})

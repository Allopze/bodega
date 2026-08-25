import { describe, expect, it } from "vitest"
import { reconcileInvoiceEvidence } from "./invoice-reconciliation"

const orderItems = [
  {
    id: "oc-1", productName: "Casco", quantity: 2, unitOfMeasure: "unidad",
    unitPrice: 50, subtotal: 100, currentSupplierPrice: 55,
  },
  {
    id: "oc-2", productName: "Guantes", quantity: 4, unitOfMeasure: "par",
    unitPrice: 25, subtotal: 100, currentSupplierPrice: 25,
  },
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
    expect(result.status).toBe("needs_review")
    expect(result.issues.map((issue) => issue.code)).toContain("invoice_without_lines")
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
          { id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: "unidad", quantity: 2, subtotal: 100 },
          { id: "line-2", purchaseOrderItemId: null, unitOfMeasure: "par", quantity: 4, subtotal: 100 },
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
            { id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: "unidad", quantity: 2, subtotal: 100 },
            { id: "line-2", purchaseOrderItemId: null, quantity: 1, subtotal: 25 },
          ],
        },
        {
          id: "linked", invoiceNumber: "003", amount: 0,
          items: [{ id: "line-3", purchaseOrderItemId: "oc-2", unitOfMeasure: "par", quantity: 4, subtotal: 100 }],
        },
      ],
    })

    expect(result.invoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ invoiceId: "without-lines", status: "without_lines" }),
      expect.objectContaining({ invoiceId: "partial", status: "partial", linkedLineCount: 1, unlinkedLineCount: 1 }),
      expect.objectContaining({ invoiceId: "linked", status: "linked_lines" }),
    ]))
  })

  it("matches effective net prices and accepts exactly one peso of variance", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 200,
      orderItems,
      invoices: [{
        id: "inv-1", invoiceNumber: "123", amount: 200,
        items: [
          { id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: "un", quantity: 2, unitPrice: 80, subtotal: 102 },
          { id: "line-2", purchaseOrderItemId: "oc-2", unitOfMeasure: "pares", quantity: 4, unitPrice: 25, subtotal: 100 },
        ],
      }],
    })

    expect(result.status).toBe("matched")
    expect(result.issues).toEqual([])
    expect(result.items[0]).toMatchObject({
      ocEffectiveUnitPrice: 50,
      invoiceEffectiveUnitPrice: 51,
      priceDifference: 1,
      pricePercentage: 2,
      currentSupplierPrice: 55,
    })
  })

  it("requires review when effective price variance exceeds one peso", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 200,
      orderItems,
      invoices: [{
        id: "inv-1", invoiceNumber: "123", amount: 200,
        items: [
          { id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: "unidad", quantity: 2, unitPrice: 100, subtotal: 104 },
          { id: "line-2", purchaseOrderItemId: "oc-2", unitOfMeasure: "par", quantity: 4, unitPrice: 25, subtotal: 100 },
        ],
      }],
    })

    expect(result.status).toBe("needs_review")
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "price_variance", orderItemId: "oc-1", difference: 2, percentage: 4,
    }))
  })

  it("reports a zero-price variance without dividing by zero", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 0,
      orderItems: [{ id: "oc-1", productName: "Bonificación", quantity: 1, unitOfMeasure: "unidad", unitPrice: 0, subtotal: 0 }],
      invoices: [{
        id: "inv-1", invoiceNumber: "123", amount: 0,
        items: [{ id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: "unidad", quantity: 1, unitPrice: 2, subtotal: 2 }],
      }],
    })

    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "price_variance", difference: 2, percentage: null,
    }))
  })

  it.each([
    { unit: null, code: "missing_unit" },
    { unit: "kg", code: "unit_mismatch" },
  ])("does not evaluate price when invoice unit is $unit", ({ unit, code }) => {
    const result = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems: [orderItems[0]!],
      invoices: [{
        id: "inv-1", invoiceNumber: "123", amount: 100,
        items: [{ id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: unit, quantity: 2, unitPrice: 80, subtotal: 160 }],
      }],
    })

    expect(result.issues.map((issue) => issue.code)).toContain(code)
    expect(result.issues.map((issue) => issue.code)).not.toContain("price_variance")
  })

  it("marks a pending OC cost and exposes its concrete invoice source", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 0,
      orderItems: [{ id: "service", productName: "Calibración", quantity: 1, unitOfMeasure: "servicio", unitPrice: null, subtotal: null }],
      invoices: [{
        id: "inv-1", invoiceNumber: "123", amount: 120,
        items: [{ id: "source-line", purchaseOrderItemId: "service", unitOfMeasure: "servicio", quantity: 1, unitPrice: 120, subtotal: 120 }],
      }],
    })

    expect(result.issues).toContainEqual(expect.objectContaining({ code: "pending_oc_cost", orderItemId: "service" }))
    expect(result.items[0]?.linkedInvoiceItemIds).toEqual(["source-line"])
  })

  it("reports partial and excess coverage across several invoices", () => {
    const partial = reconcileInvoiceEvidence({
      totalOC: 200,
      orderItems,
      invoices: [{
        id: "inv-1", invoiceNumber: "123", amount: 100,
        items: [{ id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: "unidad", quantity: 1, subtotal: 50 }],
      }],
    })
    expect(partial.status).toBe("partially_invoiced")
    expect(partial.coverage).toMatchObject({ status: "partial", pendingItemCount: 2 })

    const excess = reconcileInvoiceEvidence({
      totalOC: 200,
      orderItems: [orderItems[0]!],
      invoices: [
        { id: "inv-1", invoiceNumber: "123", amount: 50, items: [{ id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: "unidad", quantity: 1, subtotal: 50 }] },
        { id: "inv-2", invoiceNumber: "124", amount: 100, items: [{ id: "line-2", purchaseOrderItemId: "oc-1", unitOfMeasure: "unidad", quantity: 2, subtotal: 100 }] },
      ],
    })
    expect(excess.issues).toContainEqual(expect.objectContaining({ code: "quantity_over", orderItemId: "oc-1" }))
  })

  it("treats the first valid supplier invoice as partial coverage instead of an exception", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 500,
      orderItems: [{
        id: "gloves", productName: "Guantes", quantity: 10, unitOfMeasure: "par",
        unitPrice: 50, subtotal: 500, supplierReceivedQuantity: 6,
      }],
      invoices: [{
        id: "inv-1", invoiceNumber: "101", amount: 300,
        supplierIdentityStatus: "verified",
        items: [{ id: "line-1", purchaseOrderItemId: "gloves", unitOfMeasure: "par", quantity: 6, subtotal: 300 }],
      }],
    })

    expect(result.status).toBe("partially_invoiced")
    expect(result.coverage).toEqual({
      status: "partial",
      remainingAmount: 200,
      pendingItemCount: 1,
      coveredItemCount: 0,
      totalItemCount: 1,
    })
    expect(result.issues.map((issue) => issue.code)).not.toContain("quantity_under")
    expect(result.issues.map((issue) => issue.code)).not.toContain("total_mismatch")
  })

  it("keeps partial coverage blocked even when another hard difference exists", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 500,
      orderItems: [{
        id: "gloves", productName: "Guantes", quantity: 10, unitOfMeasure: "par",
        unitPrice: 50, subtotal: 500, supplierReceivedQuantity: 6,
      }],
      invoices: [{
        id: "inv-1", invoiceNumber: "101", amount: 300, supplierIdentityStatus: "verified",
        items: [{ id: "line-1", purchaseOrderItemId: "gloves", unitOfMeasure: "par", quantity: 6, unitPrice: 45, subtotal: 270 }],
      }],
    })

    expect(result.status).toBe("needs_review")
    expect(result.coverage.status).toBe("partial")
    expect(result.coverage.pendingItemCount).toBe(1)
  })

  it("reconciles one OC when two invoices cumulatively cover the ordered and received quantity", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 500,
      orderItems: [{
        id: "gloves", productName: "Guantes", quantity: 10, unitOfMeasure: "par",
        unitPrice: 50, subtotal: 500, supplierReceivedQuantity: 10,
      }],
      invoices: [
        {
          id: "inv-1", invoiceNumber: "101", amount: 300, supplierIdentityStatus: "verified",
          items: [{ id: "line-1", purchaseOrderItemId: "gloves", unitOfMeasure: "par", quantity: 6, subtotal: 300 }],
        },
        {
          id: "inv-2", invoiceNumber: "102", amount: 200, supplierIdentityStatus: "verified",
          items: [{ id: "line-2", purchaseOrderItemId: "gloves", unitOfMeasure: "par", quantity: 4, subtotal: 200 }],
        },
      ],
    })

    expect(result.status).toBe("matched")
    expect(result.coverage).toMatchObject({ status: "complete", remainingAmount: 0, coveredItemCount: 1 })
    expect(result.items[0]).toMatchObject({ invoicedQty: 10, supplierReceivedQty: 10 })
  })

  it("keeps a complete early invoice waiting for reception and rejects generic acceptance", () => {
    const input = {
      totalOC: 500,
      orderItems: [{
        id: "gloves", productName: "Guantes", quantity: 10, unitOfMeasure: "par",
        unitPrice: 50, subtotal: 500, supplierReceivedQuantity: 0,
      }],
      invoices: [{
        id: "inv-1", invoiceNumber: "101", amount: 500, supplierIdentityStatus: "verified" as const,
        items: [{ id: "line-1", purchaseOrderItemId: "gloves", unitOfMeasure: "par", quantity: 10, subtotal: 500 }],
      }],
    }
    const pending = reconcileInvoiceEvidence(input)
    const reviewed = reconcileInvoiceEvidence({
      ...input,
      reviews: [{
        id: "review-1", fingerprint: pending.fingerprint,
        reason: "Recepción todavía pendiente de registrar.", createdAt: "2026-08-25T10:00:00.000Z",
      }],
    })

    expect(pending.status).toBe("awaiting_receipt")
    expect(pending.coverage.status).toBe("complete")
    expect(reviewed.status).toBe("awaiting_receipt")
  })

  it("produces a stable fingerprint and invalidates acceptance when documents change", () => {
    const input = {
      totalOC: 100,
      orderItems: [orderItems[0]!],
      invoices: [{
        id: "inv-1", invoiceNumber: "123", amount: 100,
        items: [{ id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: null, quantity: 2, subtotal: 100 }],
      }],
    }
    const first = reconcileInvoiceEvidence(input)
    const reordered = reconcileInvoiceEvidence({ ...input, orderItems: [...input.orderItems].reverse(), invoices: [...input.invoices].reverse() })
    expect(reordered.fingerprint).toBe(first.fingerprint)
    const catalogChanged = reconcileInvoiceEvidence({
      ...input,
      orderItems: input.orderItems.map((item) => ({ ...item, currentSupplierPrice: 999 })),
    })
    expect(catalogChanged.fingerprint).toBe(first.fingerprint)


    const accepted = reconcileInvoiceEvidence({
      ...input,
      reviews: [{ id: "review-1", fingerprint: first.fingerprint, reason: "Unidad ausente aceptada por respaldo adjunto.", createdAt: "2026-08-20T10:00:00.000Z" }],
    })
    expect(accepted.status).toBe("accepted_exception")

    const changed = reconcileInvoiceEvidence({
      ...input,
      invoices: [...input.invoices, { id: "inv-2", invoiceNumber: "124", amount: 1, items: [] }],
      reviews: accepted.currentReview ? [accepted.currentReview] : [],
    })
    expect(changed.fingerprint).not.toBe(first.fingerprint)
    expect(changed.status).toBe("needs_review")
    expect(changed.currentReview).toBeNull()
    expect(changed.previousReview?.id).toBe("review-1")
  })

  it("keeps billing ahead of accepted supplier delivery waiting even with a generic acceptance", () => {
    const input = {
      totalOC: 100,
      orderItems: [{ ...orderItems[0]!, supplierReceivedQuantity: 1 }],
      invoices: [{
        id: "inv-1", invoiceNumber: "123", amount: 100,
        items: [{ id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: "unidad", quantity: 2, subtotal: 100 }],
      }],
    }
    const initial = reconcileInvoiceEvidence(input)
    const reviewed = reconcileInvoiceEvidence({
      ...input,
      reviews: [{ id: "review-1", fingerprint: initial.fingerprint, reason: "Diferencia de precio respaldada documentalmente.", createdAt: "2026-08-24T10:00:00.000Z" }],
    })

    expect(initial.issues).toContainEqual(expect.objectContaining({ code: "quantity_over_received", expected: 1, actual: 2 }))
    expect(reviewed.status).toBe("awaiting_receipt")
  })

  it("does not invalidate a prior documentary fingerprint when normal reception advances", () => {
    const base = {
      totalOC: 100,
      invoices: [{
        id: "inv-1", invoiceNumber: "123", amount: 100,
        items: [{ id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: "unidad", quantity: 2, subtotal: 100 }],
      }],
    }
    const before = reconcileInvoiceEvidence({ ...base, orderItems: [{ ...orderItems[0]!, supplierReceivedQuantity: 0 }] })
    const after = reconcileInvoiceEvidence({ ...base, orderItems: [{ ...orderItems[0]!, supplierReceivedQuantity: 2 }] })

    expect(after.fingerprint).toBe(before.fingerprint)
    expect(before.receipt.status).toBe("over_invoiced")
    expect(after.receipt.status).toBe("covered")
  })

  it("keeps a manual invoice without extracted supplier RUT auditable", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 100,
      orderItems: [{ ...orderItems[0]!, supplierReceivedQuantity: 2 }],
      invoices: [{
        id: "inv-1", invoiceNumber: "123", amount: 100, supplierIdentityStatus: "unverified",
        items: [{ id: "line-1", purchaseOrderItemId: "oc-1", unitOfMeasure: "unidad", quantity: 2, subtotal: 100 }],
      }],
    })

    expect(result.status).toBe("needs_review")
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "supplier_unverified", invoiceId: "inv-1" }))
  })
})

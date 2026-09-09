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
  it("reconciles split allocations and signed credit notes per destination", () => {
    const result = reconcileInvoiceEvidence({
      totalOC: 80_000,
      orderItems: [
        { id: "a", productName: "Casco blanco", quantity: 4, unitOfMeasure: "unidad", subtotal: 40_000 },
        { id: "b", productName: "Casco azul", quantity: 4, unitOfMeasure: "unidad", subtotal: 40_000 },
      ],
      invoices: [
        { id: "invoice", invoiceNumber: "1", amount: 100_000, items: [{
          id: "line", productName: "Cascos", productCode: null, unitOfMeasure: "unidad", quantity: 10, subtotal: 100_000,
          allocations: [{ id: "al-a", purchaseOrderItemId: "a", quantity: 6, subtotal: 60_000 }, { id: "al-b", purchaseOrderItemId: "b", quantity: 4, subtotal: 40_000 }],
        }] },
        { id: "credit", invoiceNumber: "2", amount: -20_000, items: [{
          id: "credit-line", productName: "Cascos", productCode: null, unitOfMeasure: "unidad", quantity: -2, subtotal: -20_000,
          allocations: [{ id: "al-credit", purchaseOrderItemId: "a", quantity: -2, subtotal: -20_000 }],
        }] },
      ],
    })
    expect(result.items.map(item => item.invoicedQty)).toEqual([4, 4])
    expect(result.items.map(item => item.invoiceEffectiveUnitPrice)).toEqual([10_000, 10_000])
    expect(result.items[0]?.linkedInvoiceItemIds).toEqual(["credit-line", "line"])
    expect(result.status).toBe("matched")
  })

  it("fingerprints allocation values but ignores their row order", () => {
    const allocations = [{ id: "a", purchaseOrderItemId: "oc-1", quantity: 1, subtotal: 50 }, { id: "b", purchaseOrderItemId: "oc-2", quantity: 1, subtotal: 50 }]
    const evidence = (rows: typeof allocations) => reconcileInvoiceEvidence({ totalOC: 100, orderItems, invoices: [{ id: "i", invoiceNumber: "1", amount: 100, items: [{ id: "l", productName: "Mixto", productCode: null, unitOfMeasure: "unidad", quantity: 2, subtotal: 100, allocations: rows }] }] })
    expect(evidence(allocations).fingerprint).toBe(evidence([...allocations].reverse()).fingerprint)
    expect(evidence(allocations).fingerprint).not.toBe(evidence([{ ...allocations[0]!, subtotal: 40 }, { ...allocations[1]!, subtotal: 60 }]).fingerprint)
  })

  it("keeps partially assigned documentary lines pending", () => {
    const result = reconcileInvoiceEvidence({ totalOC: 100, orderItems: [orderItems[0]!], invoices: [{ id: "i", invoiceNumber: "1", amount: 100, items: [{ id: "l", productName: "Casco", productCode: null, unitOfMeasure: "unidad", quantity: 4, subtotal: 200, allocations: [{ id: "a", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 100 }] }] }] })
    expect(result.items[0]?.invoicedQty).toBe(2)
    expect(result.lines.unlinkedLineCount).toBe(1)
    expect(result.coverage.status).toBe("partial")
  })
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
          { id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 100 }], productName: "Producto documental", productCode: null, unitOfMeasure: "unidad", quantity: 2, subtotal: 100 },
          { id: "line-2", allocations: [], productName: "Producto documental", productCode: null, unitOfMeasure: "par", quantity: 4, subtotal: 100 },
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
            { id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 100 }], productName: "Producto documental", productCode: null, unitOfMeasure: "unidad", quantity: 2, subtotal: 100 },
            { id: "line-2", allocations: [], productName: "Producto documental", productCode: null, unitOfMeasure: null, quantity: 1, subtotal: 25 },
          ],
        },
        {
          id: "linked", invoiceNumber: "003", amount: 0,
          items: [{ id: "line-3", allocations: [{ id: "line-3" + "-allocation", purchaseOrderItemId: "oc-2", quantity: 4, subtotal: 100 }], productName: "Producto documental", productCode: null, unitOfMeasure: "par", quantity: 4, subtotal: 100 }],
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
          { id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 102 }], productName: "Producto documental", productCode: null, unitOfMeasure: "un", quantity: 2, unitPrice: 80, subtotal: 102 },
          { id: "line-2", allocations: [{ id: "line-2" + "-allocation", purchaseOrderItemId: "oc-2", quantity: 4, subtotal: 100 }], productName: "Producto documental", productCode: null, unitOfMeasure: "pares", quantity: 4, unitPrice: 25, subtotal: 100 },
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
          { id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 104 }], productName: "Producto documental", productCode: null, unitOfMeasure: "unidad", quantity: 2, unitPrice: 100, subtotal: 104 },
          { id: "line-2", allocations: [{ id: "line-2" + "-allocation", purchaseOrderItemId: "oc-2", quantity: 4, subtotal: 100 }], productName: "Producto documental", productCode: null, unitOfMeasure: "par", quantity: 4, unitPrice: 25, subtotal: 100 },
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
        items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 1, subtotal: 2 }], productName: "Producto documental", productCode: null, unitOfMeasure: "unidad", quantity: 1, unitPrice: 2, subtotal: 2 }],
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
        items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 160 }], productName: "Producto documental", productCode: null, unitOfMeasure: unit, quantity: 2, unitPrice: 80, subtotal: 160 }],
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
        items: [{ id: "source-line", allocations: [{ id: "source-line" + "-allocation", purchaseOrderItemId: "service", quantity: 1, subtotal: 120 }], productName: "Producto documental", productCode: null, unitOfMeasure: "servicio", quantity: 1, unitPrice: 120, subtotal: 120 }],
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
        items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 1, subtotal: 50 }], productName: "Producto documental", productCode: null, unitOfMeasure: "unidad", quantity: 1, subtotal: 50 }],
      }],
    })
    expect(partial.status).toBe("partially_invoiced")
    expect(partial.coverage).toMatchObject({ status: "partial", pendingItemCount: 2 })

    const excess = reconcileInvoiceEvidence({
      totalOC: 200,
      orderItems: [orderItems[0]!],
      invoices: [
        { id: "inv-1", invoiceNumber: "123", amount: 50, items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 1, subtotal: 50 }], productName: "Producto documental", productCode: null, unitOfMeasure: "unidad", quantity: 1, subtotal: 50 }] },
        { id: "inv-2", invoiceNumber: "124", amount: 100, items: [{ id: "line-2", allocations: [{ id: "line-2" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 100 }], productName: "Producto documental", productCode: null, unitOfMeasure: "unidad", quantity: 2, subtotal: 100 }] },
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
        items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "gloves", quantity: 6, subtotal: 300 }], productName: "Producto documental", productCode: null, unitOfMeasure: "par", quantity: 6, subtotal: 300 }],
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
        items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "gloves", quantity: 6, subtotal: 270 }], productName: "Producto documental", productCode: null, unitOfMeasure: "par", quantity: 6, unitPrice: 45, subtotal: 270 }],
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
          items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "gloves", quantity: 6, subtotal: 300 }], productName: "Producto documental", productCode: null, unitOfMeasure: "par", quantity: 6, subtotal: 300 }],
        },
        {
          id: "inv-2", invoiceNumber: "102", amount: 200, supplierIdentityStatus: "verified",
          items: [{ id: "line-2", allocations: [{ id: "line-2" + "-allocation", purchaseOrderItemId: "gloves", quantity: 4, subtotal: 200 }], productName: "Producto documental", productCode: null, unitOfMeasure: "par", quantity: 4, subtotal: 200 }],
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
        items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "gloves", quantity: 10, subtotal: 500 }], productName: "Producto documental", productCode: null, unitOfMeasure: "par", quantity: 10, subtotal: 500 }],
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
        items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 100 }], productName: "Producto documental", productCode: null, unitOfMeasure: null, quantity: 2, subtotal: 100 }],
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
        items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 100 }], productName: "Producto documental", productCode: null, unitOfMeasure: "unidad", quantity: 2, subtotal: 100 }],
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
        items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 100 }], productName: "Producto documental", productCode: null, unitOfMeasure: "unidad", quantity: 2, subtotal: 100 }],
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
        items: [{ id: "line-1", allocations: [{ id: "line-1" + "-allocation", purchaseOrderItemId: "oc-1", quantity: 2, subtotal: 100 }], productName: "Producto documental", productCode: null, unitOfMeasure: "unidad", quantity: 2, subtotal: 100 }],
      }],
    })

    expect(result.status).toBe("needs_review")
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "supplier_unverified", invoiceId: "inv-1" }))
  })
})

describe("reconcileInvoiceEvidence · tolerancia configurable", () => {
  const orderItems = [{ id: "i1", productName: "Casco", quantity: 1, unitPrice: 10_000, subtotal: 10_000 }]
  const invoices = [{
    id: "f1", invoiceNumber: "1", amount: 10_030,
    items: [{ allocations: [{ id: "fixture-line" + "-allocation", purchaseOrderItemId: "i1", quantity: 1, subtotal: 10_030 }], id: "fixture-line", productName: "Producto documental", productCode: null, unitOfMeasure: null, quantity: 1, unitPrice: 10_030, subtotal: 10_030 }],
  }]

  it("con la tolerancia por defecto, 30 pesos de más son una discrepancia", () => {
    const ev = reconcileInvoiceEvidence({ totalOC: 10_000, orderItems, invoices })

    expect(ev.money.status).toBe("mismatch")
    expect(ev.money.tolerance).toBe(1)
  })

  it("acepta la diferencia cuando la administración amplió la tolerancia", () => {
    const ev = reconcileInvoiceEvidence({ totalOC: 10_000, orderItems, invoices, clpTolerance: 50 })

    expect(ev.money.status).toBe("matched")
    expect(ev.money.tolerance).toBe(50)
  })

  it("deja la tolerancia aplicada dentro de la evidencia, no sólo el veredicto", () => {
    // Sin esto no se puede responder después con qué regla se aceptó la
    // discrepancia: cambiar el parámetro reescribiría la historia.
    const ev = reconcileInvoiceEvidence({ totalOC: 10_000, orderItems, invoices, clpTolerance: 50 })

    expect(ev.money.tolerance).toBe(50)
  })

  it("no cambia el fingerprint al mover la tolerancia", () => {
    // La aceptación humana está atada a un estado de los DATOS. Cambiar un
    // parámetro de evaluación no debe invalidar una excepción ya revisada.
    const a = reconcileInvoiceEvidence({ totalOC: 10_000, orderItems, invoices })
    const b = reconcileInvoiceEvidence({ totalOC: 10_000, orderItems, invoices, clpTolerance: 50 })

    expect(a.fingerprint).toBe(b.fingerprint)
  })
})

describe("reconcileInvoiceEvidence · facturar contra lo ordenado o lo recibido", () => {
  /** Una mantención de monogás: se factura al ejecutarse, nadie la "recibe" en bodega. */
  const servicio = {
    id: "s1", productName: "Mantención monogás", quantity: 1,
    unitOfMeasure: "servicio", unitPrice: 80_000, subtotal: 80_000, supplierReceivedQuantity: 0,
  }
  const factura = [{
    id: "f1", invoiceNumber: "1", amount: 80_000,
    items: [{ allocations: [{ id: "fixture-line" + "-allocation", purchaseOrderItemId: "s1", quantity: 1, subtotal: 80_000 }], id: "fixture-line", productName: "Producto documental", productCode: null, quantity: 1, unitOfMeasure: "servicio", unitPrice: 80_000, subtotal: 80_000 }],
  }]

  it("por defecto exige recepción y deja la OC esperándola", () => {
    const ev = reconcileInvoiceEvidence({ totalOC: 80_000, orderItems: [servicio], invoices: factura })

    expect(ev.status).toBe("awaiting_receipt")
    expect(ev.issues.some((i) => i.code === "quantity_over_received")).toBe(true)
  })

  it("no reclama recepción en una línea que se factura contra lo ordenado", () => {
    // Es el caso del servicio: exigir recepción lo dejaba en `awaiting_receipt`
    // para siempre, porque esa recepción no va a existir nunca.
    const ev = reconcileInvoiceEvidence({
      totalOC: 80_000,
      orderItems: [{ ...servicio, invoiceControl: "ordered" as const }],
      invoices: factura,
    })

    expect(ev.status).toBe("matched")
    expect(ev.issues.some((i) => i.code === "quantity_over_received")).toBe(false)
    expect(ev.items[0]!.receiptStatus).toBe("not_evaluable")
  })

  it("mantiene la exigencia en las líneas de bienes de la misma OC", () => {
    // La política es por línea, no por orden: una OC mixta no puede perder el
    // control sobre los bienes porque traiga además un servicio.
    const bien = { id: "b1", productName: "Casco", quantity: 2, unitOfMeasure: "unidad", unitPrice: 10_000, subtotal: 20_000, supplierReceivedQuantity: 0 }
    const ev = reconcileInvoiceEvidence({
      totalOC: 100_000,
      orderItems: [{ ...servicio, invoiceControl: "ordered" as const }, bien],
      invoices: [{
        id: "f1", invoiceNumber: "1", amount: 100_000,
        items: [
          { allocations: [{ id: "fixture-line" + "-allocation", purchaseOrderItemId: "s1", quantity: 1, subtotal: 80_000 }], id: "fixture-line", productName: "Producto documental", productCode: null, quantity: 1, unitOfMeasure: "servicio", unitPrice: 80_000, subtotal: 80_000 },
          { allocations: [{ id: "fixture-line" + "-allocation", purchaseOrderItemId: "b1", quantity: 2, subtotal: 20_000 }], id: "fixture-line", productName: "Producto documental", productCode: null, quantity: 2, unitOfMeasure: "unidad", unitPrice: 10_000, subtotal: 20_000 },
        ],
      }],
    })

    expect(ev.issues.filter((i) => i.code === "quantity_over_received").map((i) => i.orderItemId)).toEqual(["b1"])
  })
})

describe("reconcileInvoiceEvidence · notas de crédito", () => {
  const item = {
    id: "i1", productName: "Casco", quantity: 10, unitOfMeasure: "unidad",
    unitPrice: 10_000, subtotal: 100_000, supplierReceivedQuantity: 10,
  }
  const factura = {
    id: "f1", invoiceNumber: "100", amount: 100_000,
    items: [{ allocations: [{ id: "fixture-line" + "-allocation", purchaseOrderItemId: "i1", quantity: 10, subtotal: 100_000 }], id: "fixture-line", productName: "Producto documental", productCode: null, quantity: 10, unitOfMeasure: "unidad", unitPrice: 10_000, subtotal: 100_000 }],
  }
  /** El proveedor devuelve 2 cascos: NC por 20.000, en negativo como en contabilidad. */
  const notaCredito = {
    id: "nc1", invoiceNumber: "5", amount: -20_000,
    items: [{ allocations: [{ id: "fixture-line" + "-allocation", purchaseOrderItemId: "i1", quantity: -2, subtotal: -20_000 }], id: "fixture-line", productName: "Producto documental", productCode: null, quantity: -2, unitOfMeasure: "unidad", unitPrice: 10_000, subtotal: -20_000 }],
  }

  it("resta del total facturado en vez de sumar", () => {
    const ev = reconcileInvoiceEvidence({ totalOC: 100_000, orderItems: [item], invoices: [factura, notaCredito] })

    expect(ev.totalInvoiced).toBe(80_000)
    expect(ev.coverage.remainingAmount).toBe(20_000)
  })

  it("devuelve la cantidad a la línea de OC, que vuelve a quedar por facturar", () => {
    const ev = reconcileInvoiceEvidence({ totalOC: 100_000, orderItems: [item], invoices: [factura, notaCredito] })

    expect(ev.items[0]!.invoicedQty).toBe(8)
    expect(ev.items[0]!.status).toBe("partial")
  })

  it("una NC que anula la factura completa deja la OC como si no se hubiera facturado", () => {
    const anulacion = { ...notaCredito, amount: -100_000, items: [{ ...notaCredito.items[0]!, quantity: -10, subtotal: -100_000, allocations: [{ ...notaCredito.items[0]!.allocations[0]!, quantity: -10, subtotal: -100_000 }] }] }
    const ev = reconcileInvoiceEvidence({ totalOC: 100_000, orderItems: [item], invoices: [factura, anulacion] })

    expect(ev.totalInvoiced).toBe(0)
    expect(ev.items[0]!.invoicedQty).toBe(0)
    expect(ev.coverage.remainingAmount).toBe(100_000)
  })

  it("no acusa sobrefacturación contra la recepción por culpa de una devolución", () => {
    // La NC baja lo facturado; jamás puede empujar la línea a "facturado de más".
    const ev = reconcileInvoiceEvidence({ totalOC: 100_000, orderItems: [item], invoices: [factura, notaCredito] })

    expect(ev.issues.some((i) => i.code === "quantity_over_received")).toBe(false)
    expect(ev.receipt.status).toBe("covered")
  })
})

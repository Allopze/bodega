import { describe, expect, it } from "vitest"
import { detectPurchasingIntegrity } from "./purchasing-detector"

const input = {
  order: { id: "po", worksiteId: "ws", invoiceReconciliationStatus: "needs_review", invoiceReconciliationFingerprint: "current" },
  currentReconciliation: { status: "needs_review", fingerprint: "current" },
  orderItems: [{ id: "a", purchaseOrderId: "po", unitOfMeasure: "unidad" }, { id: "b", purchaseOrderId: "po", unitOfMeasure: "unidad" }],
  invoiceItems: [{ id: "invoice-line", documentKind: "invoice", quantity: 10, subtotal: 100, unitOfMeasure: "unidad", allocations: [{ purchaseOrderItemId: "a", quantity: 6, subtotal: 60 }, { purchaseOrderItemId: "b", quantity: 4, subtotal: 40 }] }],
}
describe("purchasing integrity detector", () => {
  it("does not mark current needs-review reconciliation as stale", () => {
    expect(detectPurchasingIntegrity(input)).toEqual([])
  })
  it.each([{ status: "matched", fingerprint: "current" }, { status: "needs_review", fingerprint: "changed" }])("detects changed status or evidence %j", currentReconciliation => {
    expect(detectPurchasingIntegrity({ ...input, currentReconciliation })).toMatchObject([{ code: "INVOICE_RECONCILIATION_STALE", severity: "warning" }])
  })
  it.each([
    { purchaseOrderItemId: "b", quantity: 5, subtotal: 40 },
    { purchaseOrderItemId: "b", quantity: 4, subtotal: 42 },
    { purchaseOrderItemId: "b", quantity: -4, subtotal: -40 },
    { purchaseOrderItemId: "missing", quantity: 4, subtotal: 40 },
  ])("detects invalid allocation %j", allocation => {
    expect(detectPurchasingIntegrity({ ...input, invoiceItems: [{ ...input.invoiceItems[0]!, allocations: [input.invoiceItems[0]!.allocations[0]!, allocation] }] })).toMatchObject([{ code: "INVOICE_ALLOCATION_INVALID", severity: "critical" }])
  })
  it("rejects cross-order ownership even when target exists", () => {
    expect(detectPurchasingIntegrity({ ...input, orderItems: input.orderItems.map(row => ({ ...row, purchaseOrderId: "other" })) })).toMatchObject([{ code: "INVOICE_ALLOCATION_INVALID" }])
  })
  it("allows intentional partial allocation and signed credit portions", () => {
    expect(detectPurchasingIntegrity({ ...input, invoiceItems: [{ ...input.invoiceItems[0]!, documentKind: "credit_note", quantity: -10, subtotal: -100, allocations: [{ purchaseOrderItemId: "a", quantity: -6, subtotal: -60 }] }] })).toEqual([])
  })
  it("checks the documentary sign even when line and allocations agree", () => {
    expect(detectPurchasingIntegrity({ ...input, invoiceItems: [{ ...input.invoiceItems[0]!, documentKind: "credit_note" }] })).toMatchObject([{ code: "INVOICE_ALLOCATION_INVALID" }])
  })
  it("does not fingerprint display-only reconciliation fields", () => {
    const before = { ...input.currentReconciliation, fingerprint: "changed", supplierName: "Nombre anterior" }
    const after = { ...before, supplierName: "Nombre nuevo" }
    expect(detectPurchasingIntegrity({ ...input, currentReconciliation: before })[0]!.fingerprint).toBe(detectPurchasingIntegrity({ ...input, currentReconciliation: after })[0]!.fingerprint)
  })
  it("fingerprints allocation ownership evidence even when the error code is unchanged", () => {
    const rows = input.orderItems.map(row => ({ ...row, purchaseOrderId: "foreign-a" }))
    const changed = rows.map(row => ({ ...row, purchaseOrderId: "foreign-b" }))
    expect(detectPurchasingIntegrity({ ...input, orderItems: rows })[0]!.fingerprint).not.toBe(detectPurchasingIntegrity({ ...input, orderItems: changed })[0]!.fingerprint)
  })
})

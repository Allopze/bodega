import { describe, expect, it } from "vitest"
import { validateInvoiceLineAllocationSet } from "./invoice-line-allocation-validation"

const base = {
  invoiceItem: { quantity: 10, subtotal: 100_000, unitOfMeasure: "unidad" },
  orderId: "po-1",
  orderItems: [
    { id: "a", purchaseOrderId: "po-1", unitOfMeasure: "UN." },
    { id: "b", purchaseOrderId: "po-1", unitOfMeasure: "unidades" },
  ],
  allocations: [
    { purchaseOrderItemId: "a", quantity: 6, subtotal: 60_000 },
    { purchaseOrderItemId: "b", quantity: 4, subtotal: 40_000 },
  ],
  coverage: "complete" as const,
}

describe("validateInvoiceLineAllocationSet", () => {
  it("accepts a complete 6 + 4 split and administrative unit aliases", () => {
    expect(validateInvoiceLineAllocationSet(base)).toEqual({ ok: true })
  })
  it.each([
    ["QUANTITY_OVERFLOW", [{ purchaseOrderItemId: "a", quantity: 6, subtotal: 60_000 }, { purchaseOrderItemId: "b", quantity: 5, subtotal: 40_000 }]],
    ["SUBTOTAL_OVERFLOW", [{ purchaseOrderItemId: "a", quantity: 10, subtotal: 100_002 }]],
    ["DUPLICATE_TARGET", [{ purchaseOrderItemId: "a", quantity: 6, subtotal: 60_000 }, { purchaseOrderItemId: "a", quantity: 4, subtotal: 40_000 }]],
    ["SIGN_MISMATCH", [{ purchaseOrderItemId: "a", quantity: -10, subtotal: -100_000 }]],
    ["SIGN_MISMATCH", [{ purchaseOrderItemId: "a", quantity: 10, subtotal: -100_000 }]],
    ["INCOMPLETE_COVERAGE", [{ purchaseOrderItemId: "a", quantity: 6, subtotal: 60_000 }]],
    ["INCOMPLETE_COVERAGE", []],
    ["INVALID_NUMBER", [{ purchaseOrderItemId: "a", quantity: NaN, subtotal: 100_000 }]],
    ["INVALID_NUMBER", [{ purchaseOrderItemId: "a", quantity: 10, subtotal: Infinity }]],
    ["INVALID_NUMBER", [{ purchaseOrderItemId: "a", quantity: 0, subtotal: 0 }]],
    ["TARGET_NOT_FOUND", [{ purchaseOrderItemId: "missing", quantity: 10, subtotal: 100_000 }]],
  ] as const)("rejects %s", (code, allocations) => {
    expect(validateInvoiceLineAllocationSet({ ...base, allocations: [...allocations] })).toMatchObject({ ok: false, code })
  })
  it("rejects a destination in another order", () => {
    expect(validateInvoiceLineAllocationSet({ ...base, orderItems: [{ ...base.orderItems[0]!, purchaseOrderId: "other" }, base.orderItems[1]!] }))
      .toMatchObject({ ok: false, code: "CROSS_ORDER_TARGET" })
  })
  it.each([null, "", "  "])("does not substitute missing documentary UOM %s", (unitOfMeasure) => {
    expect(validateInvoiceLineAllocationSet({ ...base, invoiceItem: { ...base.invoiceItem, unitOfMeasure } }))
      .toMatchObject({ ok: false, code: "MISSING_UNIT" })
  })
  it.each([[null, "MISSING_UNIT"], ["kg", "UNIT_MISMATCH"]])("rejects target UOM %s", (unitOfMeasure, code) => {
    expect(validateInvoiceLineAllocationSet({ ...base, orderItems: base.orderItems.map(row => ({ ...row, unitOfMeasure })) }))
      .toMatchObject({ ok: false, code })
  })
  it("uses the reconciler aliases beyond units", () => {
    expect(validateInvoiceLineAllocationSet({ ...base, invoiceItem: { ...base.invoiceItem, unitOfMeasure: "kilogramos" }, orderItems: base.orderItems.map(row => ({ ...row, unitOfMeasure: "kg" })) })).toEqual({ ok: true })
  })
  it.each([1, -1])("accepts complete and partial magnitudes with document sign %s", (sign) => {
    const signed = { ...base, invoiceItem: { ...base.invoiceItem, quantity: sign * 10, subtotal: sign * 100_000 }, allocations: base.allocations.map(row => ({ ...row, quantity: sign * row.quantity, subtotal: sign * row.subtotal })) }
    expect(validateInvoiceLineAllocationSet(signed)).toEqual({ ok: true })
    expect(validateInvoiceLineAllocationSet({ ...signed, allocations: signed.allocations.slice(0, 1), coverage: "partial" })).toEqual({ ok: true })
    expect(validateInvoiceLineAllocationSet({ ...signed, allocations: [{ purchaseOrderItemId: "a", quantity: sign * 11, subtotal: sign * 100_000 }] })).toMatchObject({ code: "QUANTITY_OVERFLOW" })
    expect(validateInvoiceLineAllocationSet({ ...signed, allocations: [{ purchaseOrderItemId: "a", quantity: sign * 10, subtotal: sign * 100_002 }] })).toMatchObject({ code: "SUBTOTAL_OVERFLOW" })
  })
  it("rejects positive portions for a credit note", () => {
    expect(validateInvoiceLineAllocationSet({ ...base, invoiceItem: { ...base.invoiceItem, quantity: -10, subtotal: -100_000 } })).toMatchObject({ code: "SIGN_MISMATCH" })
  })
  it("allows clearing a partial set", () => {
    expect(validateInvoiceLineAllocationSet({ ...base, coverage: "partial", allocations: [] })).toEqual({ ok: true })
  })
  it("accepts the quantity epsilon and one peso, rejects values outside them", () => {
    const allocation = { purchaseOrderItemId: "a", quantity: 10.0000005, subtotal: 100_001 }
    expect(validateInvoiceLineAllocationSet({ ...base, allocations: [allocation] })).toEqual({ ok: true })
    expect(validateInvoiceLineAllocationSet({ ...base, allocations: [{ ...allocation, quantity: 9.999998 }] })).toMatchObject({ code: "INCOMPLETE_COVERAGE" })
  })
})

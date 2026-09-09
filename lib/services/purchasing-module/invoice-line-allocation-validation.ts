import { normalizeUnit } from "./invoice-reconciliation"
import { CLP_ROUNDING_TOLERANCE } from "./money-tolerance"

export interface InvoiceLineAllocationInput {
  purchaseOrderItemId: string
  quantity: number
  subtotal: number
}

export type InvoiceLineAllocationErrorCode =
  | "DUPLICATE_TARGET" | "CROSS_ORDER_TARGET" | "TARGET_NOT_FOUND"
  | "QUANTITY_OVERFLOW" | "SUBTOTAL_OVERFLOW" | "SIGN_MISMATCH"
  | "MISSING_UNIT" | "UNIT_MISMATCH" | "INCOMPLETE_COVERAGE" | "INVALID_NUMBER"
  | "INVOICE_ITEM_NOT_FOUND" | "OUT_OF_SCOPE" | "STALE_EVIDENCE"

interface AllocationEvidence {
  invoiceItem: { quantity: number; subtotal: number; unitOfMeasure: string | null }
  orderId: string
  orderItems: { id: string; purchaseOrderId: string; unitOfMeasure: string | null }[]
  allocations: InvoiceLineAllocationInput[]
  coverage: "partial" | "complete"
}

type AllocationValidation = { ok: true } | { ok: false; code: InvoiceLineAllocationErrorCode }
const QUANTITY_EPSILON = 0.000001

/** Checks documentary coverage, never guesses units or converts document signs. */
export function validateInvoiceLineAllocationSet(input: AllocationEvidence): AllocationValidation {
  const { invoiceItem, allocations, orderItems } = input
  const fail = (code: InvoiceLineAllocationErrorCode): AllocationValidation => ({ ok: false, code })
  if (!Number.isFinite(invoiceItem.quantity) || invoiceItem.quantity === 0 || !Number.isFinite(invoiceItem.subtotal)) return fail("INVALID_NUMBER")
  const sign = Math.sign(invoiceItem.quantity)
  if (invoiceItem.subtotal !== 0 && Math.sign(invoiceItem.subtotal) !== sign) return fail("SIGN_MISMATCH")
  const seen = new Set<string>()
  const targets = new Map(orderItems.map(item => [item.id, item]))
  let quantity = 0
  let subtotal = 0
  for (const row of allocations) {
    if (seen.has(row.purchaseOrderItemId)) return fail("DUPLICATE_TARGET")
    seen.add(row.purchaseOrderItemId)
    const target = targets.get(row.purchaseOrderItemId)
    if (!target) return fail("TARGET_NOT_FOUND")
    if (target.purchaseOrderId !== input.orderId) return fail("CROSS_ORDER_TARGET")
    if (!Number.isFinite(row.quantity) || row.quantity === 0 || !Number.isFinite(row.subtotal)) return fail("INVALID_NUMBER")
    if (Math.sign(row.quantity) !== sign || (row.subtotal !== 0 && Math.sign(row.subtotal) !== sign)) return fail("SIGN_MISMATCH")
    const unit = normalizeUnit(invoiceItem.unitOfMeasure)
    const targetUnit = normalizeUnit(target.unitOfMeasure)
    if (!unit || !targetUnit) return fail("MISSING_UNIT")
    if (unit !== targetUnit) return fail("UNIT_MISMATCH")
    quantity += Math.abs(row.quantity)
    subtotal += Math.abs(row.subtotal)
  }
  if (quantity - Math.abs(invoiceItem.quantity) > QUANTITY_EPSILON) return fail("QUANTITY_OVERFLOW")
  if (subtotal - Math.abs(invoiceItem.subtotal) > CLP_ROUNDING_TOLERANCE) return fail("SUBTOTAL_OVERFLOW")
  if (input.coverage === "complete" && (
    Math.abs(quantity - Math.abs(invoiceItem.quantity)) > QUANTITY_EPSILON ||
    Math.abs(subtotal - Math.abs(invoiceItem.subtotal)) > CLP_ROUNDING_TOLERANCE
  )) return fail("INCOMPLETE_COVERAGE")
  return { ok: true }
}

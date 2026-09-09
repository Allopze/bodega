import { validateInvoiceLineAllocationSet, type InvoiceLineAllocationInput } from "../purchasing-module/invoice-line-allocation-validation"
import { integrityFinding, type OperationalIntegrityFinding } from "./types"

interface PurchasingEvidence {
  order: { id: string; worksiteId: string; invoiceReconciliationStatus: string; invoiceReconciliationFingerprint: string | null }
  currentReconciliation: { status: string; fingerprint: string }
  orderItems: { id: string; purchaseOrderId: string; unitOfMeasure: string | null }[]
  invoiceItems: { id: string; documentKind: string; quantity: number; subtotal: number; unitOfMeasure: string | null; allocations: InvoiceLineAllocationInput[] }[]
}

export function detectPurchasingIntegrity(input: PurchasingEvidence): OperationalIntegrityFinding[] {
  const { order, currentReconciliation } = input
  const base = { domain: "purchasing" as const, entityType: "purchase_order" as const, entityId: order.id, worksiteId: order.worksiteId, href: `/compras/${encodeURIComponent(order.id)}?faena=${encodeURIComponent(order.worksiteId)}` }
  const invalid = [...input.invoiceItems].sort((a, b) => a.id.localeCompare(b.id)).flatMap(row => {
    if (!row.allocations.length) return []
    const allocations = [...row.allocations].sort((a, b) => a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId))
    const result = validateInvoiceLineAllocationSet({ invoiceItem: row, orderId: order.id, orderItems: input.orderItems, allocations, coverage: "partial" })
    const wrongDocumentSign = Math.sign(row.quantity) !== (row.documentKind === "credit_note" ? -1 : 1)
    const targets = input.orderItems.filter(target => allocations.some(allocation => allocation.purchaseOrderItemId === target.id))
      .sort((a, b) => a.id.localeCompare(b.id)).map(({ id, purchaseOrderId, unitOfMeasure }) => ({ id, purchaseOrderId, unitOfMeasure }))
    if (result.ok && !wrongDocumentSign) return []
    return [{ invoiceItemId: row.id, documentKind: row.documentKind, issue: wrongDocumentSign ? "SIGN_MISMATCH" : result.ok ? null : result.code, quantity: row.quantity, subtotal: row.subtotal, unitOfMeasure: row.unitOfMeasure, targets, allocations: allocations.map(({ purchaseOrderItemId, quantity, subtotal }) => ({ purchaseOrderItemId, quantity, subtotal })) }]
  })
  const findings: OperationalIntegrityFinding[] = []
  if (invalid.length) findings.push(integrityFinding({ ...base, code: "INVOICE_ALLOCATION_INVALID", snapshot: { lines: invalid } }))
  if (order.invoiceReconciliationStatus !== currentReconciliation.status || order.invoiceReconciliationFingerprint !== currentReconciliation.fingerprint) {
    findings.push(integrityFinding({ ...base, code: "INVOICE_RECONCILIATION_STALE", snapshot: { persisted: { status: order.invoiceReconciliationStatus, fingerprint: order.invoiceReconciliationFingerprint }, current: { status: currentReconciliation.status, fingerprint: currentReconciliation.fingerprint } } }))
  }
  return findings
}

export const CLP_RECONCILIATION_TOLERANCE = 1

export interface InvoiceReconciliationOrderItem {
  id: string
  productName: string
  quantity: number
}

export interface InvoiceReconciliationInvoiceItem {
  purchaseOrderItemId: string | null
  quantity: number
}

export interface InvoiceReconciliationInvoice {
  id: string
  invoiceNumber: string
  amount: number | null
  items?: InvoiceReconciliationInvoiceItem[]
}

export type MoneyReconciliationStatus = "no_invoices" | "matched" | "mismatch"
export type LineReconciliationStatus = "not_evaluable" | "unlinked" | "partial" | "covered"

export interface ReconciledOrderItem {
  ocItemId: string
  productName: string
  ocQuantity: number
  invoicedQty: number
  difference: number
  matched: boolean
  status: "not_evaluable" | "not_covered" | "partial" | "covered" | "over_invoiced"
}

export interface InvoiceEvidenceStatus {
  invoiceId: string
  invoiceNumber: string
  status: "without_lines" | "unlinked_lines" | "partial" | "linked_lines"
  linkedLineCount: number
  unlinkedLineCount: number
}

export interface InvoiceReconciliationEvidence {
  hasInvoices: boolean
  totalInvoiced: number
  totalOC: number
  money: {
    status: MoneyReconciliationStatus
    tolerance: number
    difference: number
  }
  lines: {
    status: LineReconciliationStatus
    invoicesWithoutLines: number
    linkedLineCount: number
    unlinkedLineCount: number
  }
  items: ReconciledOrderItem[]
  invoices: InvoiceEvidenceStatus[]
}

function quantity(value: number) {
  return Number.isFinite(value) ? value : 0
}

/**
 * Conciliación de lectura: el monto bruto CLP y las líneas documentales son
 * ejes independientes. Que el total calce jamás inventa vínculos de línea.
 */
export function reconcileInvoiceEvidence({
  totalOC,
  orderItems,
  invoices,
}: {
  totalOC: number
  orderItems: InvoiceReconciliationOrderItem[]
  invoices: InvoiceReconciliationInvoice[]
}): InvoiceReconciliationEvidence {
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + quantity(invoice.amount ?? 0), 0)
  const moneyDifference = totalInvoiced - totalOC
  const hasInvoices = invoices.length > 0
  const orderItemIds = new Set(orderItems.map((item) => item.id))
  const invoicedQtyByItemId = new Map<string, number>()
  let invoicesWithoutLines = 0
  let linkedLineCount = 0
  let unlinkedLineCount = 0

  const perInvoice = invoices.map((invoice) => {
    const lines = invoice.items ?? []
    if (lines.length === 0) {
      invoicesWithoutLines += 1
      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: "without_lines" as const,
        linkedLineCount: 0,
        unlinkedLineCount: 0,
      }
    }

    let invoiceLinked = 0
    let invoiceUnlinked = 0
    for (const line of lines) {
      if (!line.purchaseOrderItemId || !orderItemIds.has(line.purchaseOrderItemId)) {
        invoiceUnlinked += 1
        unlinkedLineCount += 1
        continue
      }
      invoiceLinked += 1
      linkedLineCount += 1
      invoicedQtyByItemId.set(
        line.purchaseOrderItemId,
        (invoicedQtyByItemId.get(line.purchaseOrderItemId) ?? 0) + quantity(line.quantity),
      )
    }

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoiceLinked === 0 ? "unlinked_lines" as const : invoiceUnlinked > 0 ? "partial" as const : "linked_lines" as const,
      linkedLineCount: invoiceLinked,
      unlinkedLineCount: invoiceUnlinked,
    }
  })

  const noLineEvidence = !hasInvoices || (linkedLineCount === 0 && unlinkedLineCount === 0)
  const items = orderItems.map((item) => {
    const invoicedQty = invoicedQtyByItemId.get(item.id) ?? 0
    const difference = item.quantity - invoicedQty
    const matched = Math.abs(difference) < 0.01
    return {
      ocItemId: item.id,
      productName: item.productName,
      ocQuantity: item.quantity,
      invoicedQty,
      difference,
      matched,
      status: noLineEvidence
        ? "not_evaluable" as const
        : invoicedQty === 0
          ? "not_covered" as const
          : matched
            ? "covered" as const
            : difference < 0
              ? "over_invoiced" as const
              : "partial" as const,
    }
  })

  const allItemsCovered = items.length > 0 && items.every((item) => item.status === "covered")
  const lineStatus: LineReconciliationStatus = noLineEvidence
    ? "not_evaluable"
    : linkedLineCount === 0
      ? "unlinked"
      : allItemsCovered && invoicesWithoutLines === 0 && unlinkedLineCount === 0
        ? "covered"
        : "partial"

  return {
    hasInvoices,
    totalInvoiced,
    totalOC,
    money: {
      status: !hasInvoices ? "no_invoices" : Math.abs(moneyDifference) <= CLP_RECONCILIATION_TOLERANCE ? "matched" : "mismatch",
      tolerance: CLP_RECONCILIATION_TOLERANCE,
      difference: moneyDifference,
    },
    lines: {
      status: lineStatus,
      invoicesWithoutLines,
      linkedLineCount,
      unlinkedLineCount,
    },
    items,
    invoices: perInvoice,
  }
}

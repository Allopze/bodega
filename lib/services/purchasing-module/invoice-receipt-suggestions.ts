import { normalizeFolio } from "@/lib/services/dte-portal/folio-match"

export interface ReceiptSuggestionInvoice {
  id: string
  purchaseOrderId: string
  invoiceNumber: string
  issueDate: string | null
  items: Array<{ purchaseOrderItemId: string | null; quantity: number }>
}

export interface ReceiptSuggestionReceipt {
  id: string
  purchaseOrderId: string
  code: string
  dispatchGuideNo: string | null
  receivedAt: string
  items: Array<{ purchaseOrderItemId: string; quantityReceived: number }>
}

export interface ReceiptLinkSuggestion {
  receiptIds: string[]
  confidence: "high" | "medium" | "low"
  ambiguous: boolean
  reasons: string[]
}

const QUANTITY_TOLERANCE = 0.01
const DAY_MS = 86_400_000

/**
 * Sugiere vínculos documentales sin persistirlos. Folio, líneas y fecha sólo
 * ordenan evidencia de la misma OC; un empate se deja a decisión humana.
 */
export function suggestReceiptLinks(
  invoice: ReceiptSuggestionInvoice,
  receipts: ReceiptSuggestionReceipt[],
): ReceiptLinkSuggestion {
  const required = new Map<string, number>()
  for (const item of invoice.items) {
    if (!item.purchaseOrderItemId || !Number.isFinite(item.quantity) || item.quantity <= 0) continue
    required.set(item.purchaseOrderItemId, (required.get(item.purchaseOrderItemId) ?? 0) + item.quantity)
  }
  const totalRequired = [...required.values()].reduce((sum, quantity) => sum + quantity, 0)
  const normalizedInvoiceNumber = normalizeFolio(invoice.invoiceNumber)
  const eligible = receipts.filter((receipt) => (
    receipt.purchaseOrderId === invoice.purchaseOrderId
    && receipt.items.some((item) => required.has(item.purchaseOrderItemId) && item.quantityReceived > 0)
  ))
  if (eligible.length === 0 || totalRequired <= 0) return emptySuggestion(false)

  const remaining = new Map(required)
  const selected: ReceiptSuggestionReceipt[] = []

  while ([...remaining.values()].some((quantity) => quantity > QUANTITY_TOLERANCE)) {
    const ranked = eligible
      .filter((receipt) => !selected.some((item) => item.id === receipt.id))
      .map((receipt) => ({
        receipt,
        exactNumber: Boolean(
          normalizedInvoiceNumber
          && normalizeFolio(receipt.dispatchGuideNo) === normalizedInvoiceNumber,
        ),
        contribution: receipt.items.reduce((sum, item) => (
          sum + Math.min(Math.max(0, remaining.get(item.purchaseOrderItemId) ?? 0), Math.max(0, item.quantityReceived))
        ), 0),
        dateDistance: calendarDayDistance(invoice.issueDate, receipt.receivedAt),
      }))
      .filter((candidate) => candidate.contribution > QUANTITY_TOLERANCE)
      .sort(compareCandidates)

    const best = ranked[0]
    if (!best) break
    const tied = ranked[1] && compareCandidateEvidence(best, ranked[1]) === 0
    if (tied) return emptySuggestion(true)

    selected.push(best.receipt)
    for (const item of best.receipt.items) {
      const pending = remaining.get(item.purchaseOrderItemId)
      if (pending === undefined) continue
      remaining.set(item.purchaseOrderItemId, Math.max(0, pending - Math.max(0, item.quantityReceived)))
    }
  }

  const remainingQuantity = [...remaining.values()].reduce((sum, quantity) => sum + Math.max(0, quantity), 0)
  const fullyCovered = remainingQuantity <= QUANTITY_TOLERANCE
  const hasExactNumber = selected.some((receipt) => (
    Boolean(normalizedInvoiceNumber)
    && normalizeFolio(receipt.dispatchGuideNo) === normalizedInvoiceNumber
  ))
  const closestDays = Math.min(...selected.map((receipt) => calendarDayDistance(invoice.issueDate, receipt.receivedAt)))
  const reasons = [
    ...(hasExactNumber ? ["Coincide el número documental normalizado."] : []),
    ...(fullyCovered ? ["Las cantidades documentadas quedan cubiertas por las recepciones sugeridas."] : ["La cobertura de cantidades es parcial."]),
    ...(Number.isFinite(closestDays) && closestDays <= 7 ? [`La emisión y la recepción están separadas por ${closestDays} día(s).`] : []),
  ]

  return {
    receiptIds: selected.map((receipt) => receipt.id),
    confidence: fullyCovered && hasExactNumber ? "high" : fullyCovered ? "medium" : "low",
    ambiguous: false,
    reasons,
  }
}

function compareCandidates(
  left: { exactNumber: boolean; contribution: number; dateDistance: number; receipt: ReceiptSuggestionReceipt },
  right: { exactNumber: boolean; contribution: number; dateDistance: number; receipt: ReceiptSuggestionReceipt },
) {
  return compareCandidateEvidence(left, right) || left.receipt.code.localeCompare(right.receipt.code)
}

function compareCandidateEvidence(
  left: { exactNumber: boolean; contribution: number; dateDistance: number },
  right: { exactNumber: boolean; contribution: number; dateDistance: number },
) {
  if (left.exactNumber !== right.exactNumber) return left.exactNumber ? -1 : 1
  if (Math.abs(left.contribution - right.contribution) > QUANTITY_TOLERANCE) return right.contribution - left.contribution
  if (left.dateDistance !== right.dateDistance) return left.dateDistance - right.dateDistance
  return 0
}

function calendarDayDistance(issueDate: string | null, receivedAt: string) {
  if (!issueDate) return Number.POSITIVE_INFINITY
  const issue = Date.parse(`${issueDate}T00:00:00.000Z`)
  const receivedDay = receivedAt.slice(0, 10)
  const received = Date.parse(`${receivedDay}T00:00:00.000Z`)
  if (!Number.isFinite(issue) || !Number.isFinite(received)) return Number.POSITIVE_INFINITY
  return Math.round(Math.abs(received - issue) / DAY_MS)
}

function emptySuggestion(ambiguous: boolean): ReceiptLinkSuggestion {
  return {
    receiptIds: [],
    confidence: "low",
    ambiguous,
    reasons: [ambiguous ? "Hay más de una recepción con la misma evidencia; requiere selección manual." : "No hay evidencia suficiente para sugerir una recepción."],
  }
}

/**
 * Lightweight invoice reconciliation service.
 *
 * Given an invoice attachment on a purchase order, compares the invoice amount
 * against the OC total amount and optionally against total received value.
 * Returns a diff summary used to surface discrepancies in the UI.
 *
 * This is intentionally lightweight — no separate invoicing module is introduced;
 * reconciliation state lives on the invoice_attachments row itself.
 */

export interface ReconciliationDiff {
  /** Invoice amount declared by the supplier */
  invoiceAmount: number
  /** OC total amount (what we agreed to pay) */
  orderAmount: number
  /** Absolute difference: invoiceAmount - orderAmount (negative = invoice is lower) */
  absoluteDiff: number
  /** Percentage difference relative to orderAmount. null when orderAmount is 0 */
  percentDiff: number | null
  /** Whether the difference is material (> 1 CLP) */
  hasDiff: boolean
  /**
   * Suggested status based on amounts alone.
   * The user still decides the final status — this is just a hint.
   */
  suggestedStatus: "reconciled" | "observed"
}

/**
 * Computes the comparison between an invoice attachment amount and the OC total.
 * Pure function — no DB calls.
 */
export function computeReconciliationDiff(
  invoiceAmount: number,
  orderAmount:   number,
): ReconciliationDiff {
  const absoluteDiff = invoiceAmount - orderAmount
  const percentDiff  = orderAmount !== 0 ? (absoluteDiff / orderAmount) * 100 : null
  const hasDiff      = Math.abs(absoluteDiff) > 1 // 1 CLP tolerance (rounding)

  return {
    invoiceAmount,
    orderAmount,
    absoluteDiff,
    percentDiff,
    hasDiff,
    suggestedStatus: hasDiff ? "observed" : "reconciled",
  }
}

/**
 * Formats the diff percentage for display. Returns null when orderAmount is 0.
 */
export function formatDiffPercent(diff: ReconciliationDiff): string | null {
  if (diff.percentDiff === null) return null
  const sign = diff.percentDiff >= 0 ? "+" : ""
  return `${sign}${diff.percentDiff.toFixed(1)}%`
}

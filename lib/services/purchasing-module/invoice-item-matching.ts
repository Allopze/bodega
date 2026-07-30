export interface InvoiceItemForMatching {
  productName: string
  productCode?: string | null
  unitOfMeasure?: string | null
  quantity: number
  unitPrice: number
}

export interface PurchaseOrderItemForMatching {
  id: string
  productName: string
  productCode: string | null
  unitOfMeasure: string
}

export type InvoiceItemMatchType = "code" | "name" | "ambiguous" | "none"

export interface InvoiceItemMatch<T extends InvoiceItemForMatching = InvoiceItemForMatching> {
  item: T
  ocItemId: string | null
  matchType: InvoiceItemMatchType
  candidateCount: number
}

/**
 * Matches only when a document line identifies exactly one OC line. Ambiguous
 * matches deliberately remain unlinked so that the operator, rather than a
 * heuristic, decides which quantity participates in reconciliation.
 */
export function matchInvoiceItemsToPurchaseOrderItems<T extends InvoiceItemForMatching>(
  extractedItems: T[],
  ocItems: PurchaseOrderItemForMatching[],
): InvoiceItemMatch<T>[] {
  return extractedItems.map((item) => {
    const byCode = item.productCode
      ? ocItems.filter((ocItem) => normalizeCode(ocItem.productCode) === normalizeCode(item.productCode))
      : []
    const resolvedCode = resolveCandidate(byCode, item.unitOfMeasure)
    if (resolvedCode) return { item, ocItemId: resolvedCode.id, matchType: "code", candidateCount: byCode.length }
    if (byCode.length > 1) return { item, ocItemId: null, matchType: "ambiguous", candidateCount: byCode.length }

    const normalizedName = normalizeText(item.productName)
    const byName = normalizedName.length >= 3
      ? ocItems.filter((ocItem) => {
          const ocName = normalizeText(ocItem.productName)
          return ocName.length >= 3 && (normalizedName.includes(ocName) || ocName.includes(normalizedName))
        })
      : []
    const resolvedName = resolveCandidate(byName, item.unitOfMeasure)
    if (resolvedName) return { item, ocItemId: resolvedName.id, matchType: "name", candidateCount: byName.length }
    if (byName.length > 1) return { item, ocItemId: null, matchType: "ambiguous", candidateCount: byName.length }

    return { item, ocItemId: null, matchType: "none", candidateCount: 0 }
  })
}

function resolveCandidate(candidates: PurchaseOrderItemForMatching[], documentUnit: string | null | undefined) {
  if (candidates.length === 1) return candidates[0]
  if (!documentUnit) return null
  const sameUnit = candidates.filter((candidate) => normalizeText(candidate.unitOfMeasure) === normalizeText(documentUnit))
  return sameUnit.length === 1 ? sameUnit[0] : null
}

function normalizeCode(value: string | null | undefined) {
  return value?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase() ?? ""
}

function normalizeText(value: string | null | undefined) {
  return value?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? ""
}

import { normalizeSizeLabel } from "@/lib/products/product-size"

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
  /**
   * Talla de la variante. El catálogo guarda el mismo nombre en todas las
   * tallas, así que sin ella las líneas de una OC con varias tallas de la
   * misma prenda son indistinguibles por nombre.
   */
  sizeLabel?: string | null
}

export type InvoiceItemMatchType = "code" | "name" | "ambiguous" | "none"
  | "unit_mismatch"

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
  const claimedOrderItemIds = new Set<string>()

  return extractedItems.map((item) => {
    const documentSize = documentSizeOf(item)
    const byCode = item.productCode
      ? ocItems.filter((ocItem) => !claimedOrderItemIds.has(ocItem.id) && normalizeCode(ocItem.productCode) === normalizeCode(item.productCode))
      : []
    const codeResolution = resolveCandidate(sizeCompatible(byCode, documentSize), item.unitOfMeasure)
    if (codeResolution.candidate) {
      claimedOrderItemIds.add(codeResolution.candidate.id)
      return { item, ocItemId: codeResolution.candidate.id, matchType: "code", candidateCount: byCode.length }
    }
    if (codeResolution.unitMismatch) return { item, ocItemId: null, matchType: "unit_mismatch", candidateCount: byCode.length }
    if (byCode.length > 1) return { item, ocItemId: null, matchType: "ambiguous", candidateCount: byCode.length }

    const normalizedName = normalizeText(item.productName)
    const byName = normalizedName.length >= 3
      ? ocItems.filter((ocItem) => !claimedOrderItemIds.has(ocItem.id) && (() => {
          const ocName = normalizeText(ocItem.productName)
          return ocName.length >= 3 && (normalizedName.includes(ocName) || ocName.includes(normalizedName))
        })())
      : []
    const nameResolution = resolveCandidate(sizeCompatible(byName, documentSize), item.unitOfMeasure)
    if (nameResolution.candidate) {
      claimedOrderItemIds.add(nameResolution.candidate.id)
      return { item, ocItemId: nameResolution.candidate.id, matchType: "name", candidateCount: byName.length }
    }
    if (nameResolution.unitMismatch) return { item, ocItemId: null, matchType: "unit_mismatch", candidateCount: byName.length }
    if (byName.length > 1) return { item, ocItemId: null, matchType: "ambiguous", candidateCount: byName.length }

    return { item, ocItemId: null, matchType: "none", candidateCount: 0 }
  })
}

/**
 * Talla que declara la línea del documento: al final del código del proveedor
 * (`12-01-011-T-2XL`) o del nombre (`… T/XXL`, `… T- XL`, `… T T41`). `null`
 * cuando no declara ninguna; nunca se adivina desde el medio del texto.
 */
export function documentSizeOf(item: Pick<InvoiceItemForMatching, "productName" | "productCode">): string | null {
  const raw = item.productCode?.trim().match(/-T-([A-Z0-9]+)$/i)?.[1]
    ?? item.productName.trim().match(/\bT\s*[-/]?\s*([0-9]*X*[SML]|\d+X?L|T?\d{2})$/i)?.[1]
  return raw ? normalizeSizeLabel(raw) || null : null
}

/**
 * Descarta los candidatos cuya talla contradice la del documento. Un candidato
 * sin talla declarada sigue en juego: la talla sólo excluye con evidencia.
 */
function sizeCompatible(candidates: PurchaseOrderItemForMatching[], documentSize: string | null) {
  if (!documentSize) return candidates
  return candidates.filter((candidate) =>
    !candidate.sizeLabel || normalizeSizeLabel(candidate.sizeLabel) === documentSize)
}

function resolveCandidate(candidates: PurchaseOrderItemForMatching[], documentUnit: string | null | undefined): {
  candidate: PurchaseOrderItemForMatching | null
  unitMismatch: boolean
} {
  if (candidates.length === 0) return { candidate: null, unitMismatch: false }

  if (candidates.length === 1) {
    const [candidate] = candidates
    if (!documentUnit || areEquivalentUnits(candidate!.unitOfMeasure, documentUnit)) {
      return { candidate: candidate!, unitMismatch: false }
    }
    return { candidate: null, unitMismatch: true }
  }

  if (!documentUnit) return { candidate: null, unitMismatch: false }
  const sameUnit = candidates.filter((candidate) => areEquivalentUnits(candidate.unitOfMeasure, documentUnit))
  return { candidate: sameUnit.length === 1 ? sameUnit[0]! : null, unitMismatch: false }
}

function normalizeCode(value: string | null | undefined) {
  return value?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase() ?? ""
}

function normalizeText(value: string | null | undefined) {
  return value?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? ""
}

/**
 * Compara unidades como significado, sin modificar el texto que se conserva
 * como evidencia del documento. Sólo agrupa alias administrativos inequívocos
 * de "unidad"; no adivina equivalencias físicas como par, kg o litro.
 */
export function areEquivalentUnits(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeUnitOfMeasure(left)
  const normalizedRight = normalizeUnitOfMeasure(right)
  return normalizedLeft !== null && normalizedLeft === normalizedRight
}

export function normalizeUnitOfMeasure(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null

  const compact = normalized.replace(/\s+/g, "")
  if (["un", "und", "unidad", "unidades"].includes(compact)) return "unidad"

  return normalized
}

import { formatCLP } from "@/lib/utils"
import type { PendingItemOption } from "./oc-form.types"

export function itemSupplierId(
  item: PendingItemOption,
  nextSupplierId: string,
) {
  return item.suggestedSupplierId || nextSupplierId || ""
}

/**
 * `COT-001`: el total adjudicado sólo es el precio de esta línea cuando la
 * oferta cubría **una sola**. Con varias, repartirlo sería inventar el dato.
 */
export function awardedUnitPrice(item: PendingItemOption): number | undefined {
  if (!item.awardedQuotationId || item.awardedQuotationTotal == null) return undefined
  if ((item.awardedLineCount ?? 0) !== 1) return undefined
  if (item.quantity <= 0) return undefined
  return item.awardedQuotationTotal / item.quantity
}

export function suggestedPrice(
  item: PendingItemOption,
  nextSupplierId: string,
) {
  // La oferta adjudicada manda sobre el precio de catálogo: es el compromiso
  // comercial que se acaba de tomar, no una referencia histórica.
  const awarded = awardedUnitPrice(item)
  if (awarded !== undefined) return awarded
  return nextSupplierId ? item.supplierPrices[nextSupplierId] : undefined
}

export function applySuggestedPrices(
  items: PendingItemOption[],
  nextSupplierId: string,
  getSupplierId: (item: PendingItemOption) => string,
) {
  const next: Record<string, number> = {}
  for (const item of items) {
    const awarded = awardedUnitPrice(item)
    if (awarded !== undefined) { next[item.id] = awarded; continue }
    const id   = getSupplierId(item)
    const price = id ? item.supplierPrices[id] : undefined
    if (price !== undefined) next[item.id] = price
  }
  return next
}

export function priceHint(item: PendingItemOption, nextSupplierId: string) {
  /*
   * COT-001: con una adjudicación detrás, la pista es esa y no el catálogo.
   * Cuando la oferta cubre varias líneas se muestra su total como contraste
   * —para que una diferencia material se vea— sin prefijar nada.
   */
  if (item.awardedQuotationId && item.awardedQuotationTotal != null) {
    return (item.awardedLineCount ?? 0) === 1
      ? `Oferta adjudicada: ${formatCLP(item.awardedQuotationTotal)}`
      : `Oferta adjudicada por ${formatCLP(item.awardedQuotationTotal)} en ${item.awardedLineCount} líneas: reparte el precio tú`
  }
  const price = nextSupplierId ? item.supplierPrices[nextSupplierId] : undefined
  if (price === undefined) return null
  return `Precio catálogo: ${formatCLP(price)}`
}

export function suggestedSupplierLabel(
  item: PendingItemOption,
  suppliers: { id: string; name: string }[],
) {
  const suggestedSupplier = item.suggestedSupplierId
    ? suppliers.find((s) => s.id === item.suggestedSupplierId)
    : null
  return suggestedSupplier ? suggestedSupplier.name : (item.supplierHint ?? null)
}

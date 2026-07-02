import { formatCLP } from "@/lib/utils"
import type { PendingItemOption } from "./oc-form.types"

export function itemSupplierId(
  item: PendingItemOption,
  nextSupplierId: string,
) {
  return item.suggestedSupplierId || nextSupplierId || ""
}

export function suggestedPrice(
  item: PendingItemOption,
  nextSupplierId: string,
) {
  return nextSupplierId ? item.supplierPrices[nextSupplierId] : undefined
}

export function applySuggestedPrices(
  items: PendingItemOption[],
  nextSupplierId: string,
  getSupplierId: (item: PendingItemOption) => string,
) {
  const next: Record<string, number> = {}
  for (const item of items) {
    const id   = getSupplierId(item)
    const price = id ? item.supplierPrices[id] : undefined
    if (price !== undefined) next[item.id] = price
  }
  return next
}

export function priceHint(item: PendingItemOption, nextSupplierId: string) {
  const price = suggestedPrice(item, nextSupplierId)
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

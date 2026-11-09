import { formatCLP } from "@/lib/utils"
import type { LinkedSparePart, PendingItemOption } from "./oc-form.types"

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

/**
 * Precio unitario que estimó el solicitante. Un 0 no cuenta: el campo admite
 * cero pero no informa nada, y prefijarlo convertiría el «costo pendiente» de
 * un servicio en una línea de $0.
 */
export function requesterEstimatedPrice(item: PendingItemOption): number | undefined {
  const estimated = item.estimatedUnitPrice
  return estimated != null && Number.isFinite(estimated) && estimated > 0 ? estimated : undefined
}

export function suggestedPrice(
  item: PendingItemOption,
  nextSupplierId: string,
) {
  // La oferta adjudicada manda sobre todo: es el compromiso comercial que se
  // acaba de tomar. Después viene lo que el solicitante estimó para ESTE ítem
  // —más específico que el precio de catálogo de un producto— y al final el
  // catálogo, que es una referencia histórica.
  const awarded = awardedUnitPrice(item)
  if (awarded !== undefined) return awarded
  const estimated = requesterEstimatedPrice(item)
  if (estimated !== undefined) return estimated
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
    const estimated = requesterEstimatedPrice(item)
    if (estimated !== undefined) { next[item.id] = estimated; continue }
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
  const estimated = requesterEstimatedPrice(item)
  if (estimated !== undefined) return `Precio estimado por el solicitante: ${formatCLP(estimated)}`
  const price = nextSupplierId ? item.supplierPrices[nextSupplierId] : undefined
  if (price === undefined) return null
  return `Precio catálogo: ${formatCLP(price)}`
}

/**
 * Rótulo corto bajo el campo de precio: de dónde salió lo que hay escrito. Sigue
 * las mismas ramas que `priceHint` para que ambos digan lo mismo; antes el
 * rótulo era siempre «catálogo», que con un estimado del solicitante mentiría.
 */
export function priceSourceLabel(
  item: PendingItemOption,
  nextSupplierId: string,
): "adjudicada" | "estimado" | "catálogo" | null {
  if (item.awardedQuotationId && item.awardedQuotationTotal != null) return "adjudicada"
  if (requesterEstimatedPrice(item) !== undefined) return "estimado"
  const price = nextSupplierId ? item.supplierPrices[nextSupplierId] : undefined
  return price === undefined ? null : "catálogo"
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

/**
 * El envío dice cuántas OC nacen, no sólo cuántos ítems entran: con ítems de
 * dos proveedores el botón anunciaba «Crear OC (5 ítems)» y el resumen de al
 * lado decía «2 OC». Con una sola OC se conserva el rótulo de siempre.
 */
export function ocSubmitLabel(itemCount: number, orderCount: number): string {
  const items = `${itemCount} ítem${itemCount !== 1 ? "s" : ""}`
  return orderCount > 1 ? `Crear ${orderCount} OC · ${items}` : `Crear OC (${items})`
}

/* ── Catalogar al comprar ─────────────────────────────────────────────────────
 * Una línea de repuesto pedida en texto libre puede vincularse a un repuesto del
 * catálogo al armar la OC. El vínculo es estado del formulario: se escribe al
 * crear la OC. */

/** ¿Se puede catalogar esta línea? Repuestos pedidos en texto libre, sin producto. */
export function canCatalogLine(item: PendingItemOption): boolean {
  return item.requestType === "repuestos" && !item.productId && !item.isService
}

/**
 * La línea tal como queda con el repuesto vinculado: el producto, su SKU y N° de
 * parte, y el precio de catálogo por proveedor —que alimenta el último escalón
 * de `suggestedPrice`—. No toca la descripción que escribió quien pidió.
 */
export function applyLinkedPart(item: PendingItemOption, part: LinkedSparePart | undefined): PendingItemOption {
  if (!part) return item
  return {
    ...item,
    productId:      part.id,
    productSku:     part.sku,
    isSparePart:    true,
    partNumber:     part.partNumber,
    supplierPrices: part.prices,
  }
}

/** «RPT-004 · N° 1R-0750»: cómo se nombra un repuesto vinculado junto a la línea. */
export function sparePartTag(part: { sku: string | null; partNumber: string | null }): string {
  return [part.sku, part.partNumber ? `N° ${part.partNumber}` : null].filter(Boolean).join(" · ")
}

/**
 * Lo que se precarga al crear el repuesto desde la línea: la descripción que
 * escribió quien pidió y su N° de parte. La marca NO se precarga: el atributo
 * «Marca» de la solicitud es la del equipo (Caterpillar, Volvo), no la del
 * fabricante del repuesto, y copiarla ensuciaría la clave de N° de parte + marca.
 */
export function sparePartDraftFromLine(item: PendingItemOption): { name: string; partNumber: string } {
  return {
    name: (item.productNameFree ?? item.productName).trim(),
    partNumber: (item.requestedPartNumber ?? "").trim(),
  }
}

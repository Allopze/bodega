import { groupProductVariants, type ProductVariantLike } from "@/lib/products/variant-grouping"

/**
 * Lo que el buscador necesita de una opción. Un `ProductOption` ya lo cumple
 * (los tres campos extra son opcionales), de modo que el uso con EPP no cambia;
 * el catálogo de repuestos los llena (`spare-part-options.ts`).
 */
export interface PickerOption extends ProductVariantLike {
  /** Segunda línea del renglón (N° de parte y marca de un repuesto). */
  detail?: string | null
  /** Textos que además del nombre y el SKU encuentran la opción (N° de parte, marca). */
  searchTerms?: readonly string[]
  /** Por qué sube en la lista; se rotula en el renglón («Para este equipo»). */
  badge?: string | null
  /** Explica la insignia al pasar el puntero (a11y: un rótulo corto sin contexto no basta). */
  badgeTitle?: string | null
}

export function normalizePickerText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-CL")
}

/**
 * Sin separadores: «1r0750» y «1R 0750» encuentran el N° de parte «1R-0750», que
 * es como lo teclea quien lo lee de la caja del repuesto.
 */
function compactPickerText(normalized: string) {
  return normalized.replace(/[^\p{L}\p{N}]+/gu, "")
}

export function filterProductsForPicker<T extends PickerOption>(products: T[], query: string): T[] {
  const trimmed = query.trim()
  if (!trimmed) return products

  const needle = normalizePickerText(trimmed)
  const compactNeedle = compactPickerText(needle)
  return products.filter((product) => {
    const name = normalizePickerText(product.name)
    const sku = normalizePickerText(product.sku)
    if (name.includes(needle) || sku.includes(needle)) return true
    return (product.searchTerms ?? []).some((term) => {
      const normalizedTerm = normalizePickerText(term)
      return normalizedTerm.includes(needle)
        || (compactNeedle.length > 0 && compactPickerText(normalizedTerm).includes(compactNeedle))
    })
  })
}

/** Familias mostradas cuando no hay búsqueda escrita. */
const PICKER_GROUP_LIMIT = 50

export function groupProductsForPicker<T extends PickerOption>(products: T[], query: string) {
  // El recorte va DESPUÉS de agrupar: cortando antes, 50 filas de variantes
  // podían ser apenas 4 o 5 familias reales (una familia de EPP con tallas y
  // colores gasta decenas de filas por sí sola).
  const groups = groupProductVariants(filterProductsForPicker(products, query))
  return query.trim() ? groups : groups.slice(0, PICKER_GROUP_LIMIT)
}

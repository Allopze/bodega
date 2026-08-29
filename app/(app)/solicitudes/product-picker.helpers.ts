import type { ProductOption } from "./request-form.types"
import { groupProductVariants } from "@/lib/products/variant-grouping"

export function normalizePickerText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-CL")
}

export function filterProductsForPicker(products: ProductOption[], query: string) {
  const trimmed = query.trim()
  if (!trimmed) return products

  const needle = normalizePickerText(trimmed)
  return products.filter((product) => {
    const name = normalizePickerText(product.name)
    const sku = normalizePickerText(product.sku)
    return name.includes(needle) || sku.includes(needle)
  })
}

/** Familias mostradas cuando no hay búsqueda escrita. */
const PICKER_GROUP_LIMIT = 50

export function groupProductsForPicker(products: ProductOption[], query: string) {
  // El recorte va DESPUÉS de agrupar: cortando antes, 50 filas de variantes
  // podían ser apenas 4 o 5 familias reales (una familia de EPP con tallas y
  // colores gasta decenas de filas por sí sola).
  const groups = groupProductVariants(filterProductsForPicker(products, query))
  return query.trim() ? groups : groups.slice(0, PICKER_GROUP_LIMIT)
}

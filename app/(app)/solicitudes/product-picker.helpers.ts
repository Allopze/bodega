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
  if (!trimmed) return products.slice(0, 50)

  const needle = normalizePickerText(trimmed)
  return products.filter((product) => {
    const name = normalizePickerText(product.name)
    const sku = normalizePickerText(product.sku)
    return name.includes(needle) || sku.includes(needle)
  })
}

export function groupProductsForPicker(products: ProductOption[], query: string) {
  return groupProductVariants(filterProductsForPicker(products, query))
}

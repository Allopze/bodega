export interface ProductAttributeSummary {
  name: string
  sortOrder: number
  options: string | null
}

export function formatProductAttributeNames(attributes: ProductAttributeSummary[]) {
  if (attributes.length === 0) return "—"

  return [...attributes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((attribute) => attribute.name)
    .join(" · ")
}

export interface VariantAttribute {
  name: string
  options?: string | null
}

export interface ProductVariantLike {
  id: string
  name: string
  sku: string
  familyId?: string | null
  attributes: VariantAttribute[]
}

export interface ProductVariantGroup<T extends ProductVariantLike> {
  id: string
  name: string
  variants: T[]
}

function normalizedProductName(name: string) {
  return name.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL")
}

function parseOptions(options: string | null | undefined) {
  if (!options) return []
  try {
    const parsed = JSON.parse(options)
    if (Array.isArray(parsed)) return parsed.map((option) => String(option).trim()).filter(Boolean)
  } catch {
    // Older catalog records can still have comma or newline-separated options.
  }
  return options.split(/[\n,]/).map((option) => option.trim()).filter(Boolean)
}

export function formatProductVariant(attributes: VariantAttribute[], fallbackSku: string) {
  const description = attributes
    .map((attribute) => {
      const options = parseOptions(attribute.options)
      if (options.length === 0) return attribute.name
      return `${attribute.name}: ${options.join(" / ")}`
    })
    .join(" · ")

  return description || fallbackSku
}

export function groupProductVariants<T extends ProductVariantLike>(products: T[]): ProductVariantGroup<T>[] {
  const groups = new Map<string, ProductVariantGroup<T>>()

  for (const product of products) {
    const id = product.familyId ?? normalizedProductName(product.name)
    const group = groups.get(id)
    if (group) group.variants.push(product)
    else groups.set(id, { id, name: product.name, variants: [product] })
  }

  return [...groups.values()]
}

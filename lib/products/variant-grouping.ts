import { normalizeAttributeName } from "./attribute-names"
import { parseSizeOptions } from "./product-size"

export interface VariantAttribute {
  name: string
  options?: string | null
  type?: string
  sizeFamily?: string | null
}

export interface ResolvedVariantAttribute { name: string; value: string }

/** Only singleton selects identify a catalog variant; templates are not values. */
export function resolveVariantAttributes(attributes: readonly VariantAttribute[]): ResolvedVariantAttribute[] {
  return attributes.flatMap((attribute) => {
    if (attribute.type && attribute.type !== "select") return []
    const options = parseSizeOptions(attribute.options)
    return options.length === 1 ? [{ name: attribute.name, value: options[0]! }] : []
  })
}

/** Recorded item values take precedence over the current catalog. */
export function mergeVariantAttributes(
  attributes: readonly VariantAttribute[],
  recorded: readonly ResolvedVariantAttribute[] = [],
): ResolvedVariantAttribute[] {
  const values = new Map(resolveVariantAttributes(attributes).map((a) => [normalizeAttributeName(a.name), a]))
  for (const attribute of recorded) values.set(normalizeAttributeName(attribute.name), attribute)
  return [...values.values()].filter((a) => a.name.trim() && a.value.trim())
}

export function formatVariantProductName(
  name: string,
  attributes: readonly VariantAttribute[] | null = [],
  recorded: readonly ResolvedVariantAttribute[] = [],
): string {
  const detail = mergeVariantAttributes(attributes ?? [], recorded).map((a) => `${a.name}: ${a.value}`).join(" · ")
  return detail ? `${name} · ${detail}` : name
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

/**
 * Clave de la familia a la que pertenece una variante.
 *
 * `familyId` es la relación real; el nombre normalizado es el respaldo para el
 * catálogo previo a las familias, donde las variantes sólo se reconocían por
 * compartir nombre. Exportada porque Entregas agrupa el stock por la misma
 * regla: dos criterios distintos dejaban la talla elegible en Solicitudes e
 * inseleccionable en Entregas.
 */
export function variantGroupKey(product: Pick<ProductVariantLike, "name" | "familyId">): string {
  return product.familyId ?? normalizedProductName(product.name)
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
    const id = variantGroupKey(product)
    const group = groups.get(id)
    if (group) group.variants.push(product)
    else groups.set(id, { id, name: product.name, variants: [product] })
  }

  return [...groups.values()]
}

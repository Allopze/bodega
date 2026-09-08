import { normalizeAttributeName } from "./attribute-names"
import { compareSizeLabels, parseSizeOptions, resolveProductSize } from "./product-size"

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

/**
 * Orden de presentación de las variantes dentro de su familia.
 *
 * Existe porque el orden de la consulta no alcanza: el importador quita la
 * talla del nombre, así que todas las variantes de una familia comparten
 * `products.name` exacto y un `ORDER BY name` empata en todas. Postgres las
 * devolvía en el orden del plan, y el catálogo mostraba `2XL, XS, L, M`.
 *
 * La talla manda (`compareSizeLabels`, la misma regla que Solicitudes) y el SKU
 * es el desempate final para que el orden sea estable entre consultas y no
 * dependa del plan.
 */
export function compareVariantsForDisplay(
  left: Pick<ProductVariantLike, "sku" | "attributes">,
  right: Pick<ProductVariantLike, "sku" | "attributes">,
): number {
  const leftSize = resolveProductSize(left.attributes)
  const rightSize = resolveProductSize(right.attributes)

  if (leftSize && rightSize) {
    const bySize = compareSizeLabels(leftSize.label, rightSize.label)
    if (bySize !== 0) return bySize
  } else if (Boolean(leftSize) !== Boolean(rightSize)) {
    // Una familia puede mezclar ejes (talla, color, modelo). La que declara
    // talla va primero: es el eje por el que el bodeguero busca.
    return leftSize ? -1 : 1
  }

  // Sin atributos, `formatProductVariant` cae al SKU: comparar eso contra un
  // `Color: Blanco` es comparar una etiqueta con un código. La variante sin
  // identificar va al final y se ordena entre sus pares por SKU.
  if (left.attributes.length === 0 || right.attributes.length === 0) {
    if (left.attributes.length !== right.attributes.length) return left.attributes.length === 0 ? 1 : -1
    return left.sku.localeCompare(right.sku, "es-CL")
  }

  const byLabel = formatProductVariant(left.attributes, left.sku)
    .localeCompare(formatProductVariant(right.attributes, right.sku), "es-CL")
  if (byLabel !== 0) return byLabel

  return left.sku.localeCompare(right.sku, "es-CL")
}

export function groupProductVariants<T extends ProductVariantLike>(products: T[]): ProductVariantGroup<T>[] {
  const groups = new Map<string, ProductVariantGroup<T>>()

  for (const product of products) {
    const id = variantGroupKey(product)
    const group = groups.get(id)
    if (group) group.variants.push(product)
    else groups.set(id, { id, name: product.name, variants: [product] })
  }

  for (const group of groups.values()) group.variants.sort(compareVariantsForDisplay)

  return [...groups.values()]
}

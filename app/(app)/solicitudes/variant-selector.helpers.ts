import type { ProductOption } from "./request-form.types"
import {
  compareSizeLabels,
  normalizeSizeLabel,
  resolveProductSize,
} from "@/lib/products/product-size"

export interface SizeVariantChoice {
  id: string
  label: string
}

export interface SizeVariantPicker {
  attributeName: string
  choices: SizeVariantChoice[]
}

/**
 * A product family can be stored as one catalog row per size. Convert that
 * representation into the single choice a requester needs to make.
 *
 * Qué cuenta como talla, cómo se escribe y en qué orden se muestra lo decide
 * `lib/products/product-size`: es la misma regla que usa Entregas, y tenerla
 * duplicada acá dejó estas opciones ordenadas por el orden de la consulta
 * (`L M S XL`) en vez de por talla.
 */
export function getSizeVariantPicker(variants: ProductOption[]): SizeVariantPicker | null {
  if (variants.length < 2) return null

  const resolved: Array<SizeVariantChoice & { attributeName: string }> = []
  for (const variant of variants) {
    const size = resolveProductSize(variant.attributes)
    if (!size) return null
    resolved.push({ id: variant.id, attributeName: size.attributeName, label: size.label })
  }

  const attributeNames = new Set(resolved.map((choice) => choice.attributeName))
  // Dos tallas escritas distinto (`42` y `42.0`) son la misma talla: ofrecerlas
  // como opciones separadas haría elegir entre dos variantes indistinguibles.
  const labels = new Set(resolved.map((choice) => normalizeSizeLabel(choice.label)))
  if (attributeNames.size !== 1 || labels.size !== resolved.length) return null

  return {
    attributeName: resolved[0]!.attributeName,
    choices: resolved
      .sort((left, right) => compareSizeLabels(left.label, right.label))
      .map(({ id, label }) => ({ id, label })),
  }
}

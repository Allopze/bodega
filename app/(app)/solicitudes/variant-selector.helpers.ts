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

  // Dos tallas escritas distinto (`42` y `42.0`, o `T/L` y `L`) son la misma
  // talla: ofrecerlas como opciones separadas haría elegir entre dos variantes
  // indistinguibles. Éste es el único motivo para descartar la familia: se
  // basa en las tallas ya resueltas, no en si el atributo se llama igual en
  // todas las filas.
  const labels = new Set(resolved.map((choice) => normalizeSizeLabel(choice.label)))
  if (labels.size !== resolved.length) return null

  // `resolveProductSize` sólo devuelve atributos para los que
  // `isSizeAttributeName` es verdadero, así que todos comparten el mismo eje
  // de talla aunque el nombre difiera: una familia re-importada fila por fila
  // queda con `Talla guantes` en la variante nueva y `Talla` (legacy) en el
  // resto — el estado intermedio esperado de esa migración, no un error que
  // deba ocultar el selector. Se muestra el nombre más específico (no el
  // genérico "Talla") cuando hay uno.
  const attributeName = resolved.find((choice) => choice.attributeName.trim().toLowerCase() !== "talla")?.attributeName
    ?? resolved[0]!.attributeName

  return {
    attributeName,
    choices: resolved
      .sort((left, right) => compareSizeLabels(left.label, right.label))
      .map(({ id, label }) => ({ id, label })),
  }
}

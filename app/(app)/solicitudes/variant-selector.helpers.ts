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

  // Una variante sin talla dentro de una familia con tallas es una fila
  // histórica del importador («Chaleco Geologo» con sólo Color junto a sus
  // hermanas T/L y T/S). Descartaba la familia entera y quien pedía veía la
  // lista genérica «Variante» en vez de elegir talla. Se deja fuera de las
  // opciones: no se le puede ofrecer una talla que no tiene, y no se da de
  // baja desde acá porque suele tener historial (ver `epp-size-ranges`).
  const resolved: Array<SizeVariantChoice & { attributeName: string }> = []
  for (const variant of variants) {
    const size = resolveProductSize(variant.attributes)
    if (!size) continue
    resolved.push({ id: variant.id, attributeName: size.attributeName, label: size.label })
  }
  if (resolved.length === 0) return null

  // Dos tallas escritas distinto (`42` y `42.0`, o `T/L` y `L`) son la misma
  // talla. Ofrecerlas como dos opciones haría elegir entre variantes
  // indistinguibles, y descartar la familia entera —lo que se hacía— dejaba a
  // quien pide sin selector de talla por un duplicado de catálogo que no puede
  // resolver. Se ofrece la talla una vez, apuntando a la variante de SKU menor:
  // estable entre cargas, y la limpieza del duplicado sigue siendo de catálogo
  // (`retireDuplicateSizeVariants`, unificaciones con historial).
  const bySize = new Map<string, (typeof resolved)[number] & { sku: string }>()
  for (const choice of resolved) {
    const key = normalizeSizeLabel(choice.label)
    const sku = variants.find((variant) => variant.id === choice.id)!.sku
    const current = bySize.get(key)
    if (!current || sku.localeCompare(current.sku, "es-CL") < 0) bySize.set(key, { ...choice, sku })
  }
  const unique = [...bySize.values()]

  // `resolveProductSize` sólo devuelve atributos para los que
  // `isSizeAttributeName` es verdadero, así que todos comparten el mismo eje
  // de talla aunque el nombre difiera: una familia re-importada fila por fila
  // queda con `Talla guantes` en la variante nueva y `Talla` (legacy) en el
  // resto — el estado intermedio esperado de esa migración, no un error que
  // deba ocultar el selector. Se muestra el nombre más específico (no el
  // genérico "Talla") cuando hay uno.
  const attributeName = unique.find((choice) => choice.attributeName.trim().toLowerCase() !== "talla")?.attributeName
    ?? unique[0]!.attributeName

  return {
    attributeName,
    choices: unique
      .sort((left, right) => compareSizeLabels(left.label, right.label))
      .map(({ id, label }) => ({ id, label })),
  }
}

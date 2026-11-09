/**
 * Cómo se muestra una línea atada a un repuesto de catálogo.
 *
 * Una línea pedida en texto libre guarda su descripción (`product_name_free`) y
 * el N° de parte que escribió quien pidió como atributo libre «N° de Parte».
 * Si Compras la cataloga al armar la OC, la línea gana `product_id` pero
 * conserva ambos: la lógica que deshace ese vínculo al anular la OC necesita el
 * texto libre, así que no se borra. Al mostrarla, en cambio, el repuesto manda:
 * nombre, SKU y su N° de parte una sola vez, sin el texto ni el número libres.
 *
 * Sólo presentación: no toca datos.
 */
import { REPUESTO_ATTRIBUTE_NAMES } from "@/lib/validation/repuestos"

/** El rótulo con el que el repuesto dice su N° de parte (el mismo de la ficha del repuesto). */
export const CATALOG_PART_NUMBER_LABEL = "N° de parte"

export interface CatalogPartLike {
  isSparePart?: boolean | null
  partNumber?: string | null
}

export interface RecordedAttribute {
  attributeName: string
  value: string
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("es-CL") === b.trim().toLocaleLowerCase("es-CL")
}

/** ¿Es el atributo libre «N° de Parte» que escribió quien pidió? */
export function isFreePartNumberAttribute(name: string): boolean {
  return sameName(name, REPUESTO_ATTRIBUTE_NAMES.partNumber)
}

/**
 * Los atributos de la línea tal como se muestran. Con un repuesto de catálogo,
 * el N° de parte libre se reemplaza por el del repuesto (primero, una sola vez);
 * sin repuesto, o con un producto que no es repuesto, quedan como están.
 */
export function withCatalogPartNumber<T extends RecordedAttribute>(
  product: CatalogPartLike | null | undefined,
  recorded: readonly T[] | null | undefined,
): RecordedAttribute[] {
  const attributes = [...(recorded ?? [])]
  if (!product?.isSparePart) return attributes
  const rest = attributes.filter((attribute) => !isFreePartNumberAttribute(attribute.attributeName))
  const partNumber = product.partNumber?.trim()
  return partNumber ? [{ attributeName: CATALOG_PART_NUMBER_LABEL, value: partNumber }, ...rest] : rest
}

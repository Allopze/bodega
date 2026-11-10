/**
 * Cómo se muestra una línea atada a un repuesto de catálogo.
 *
 * Una línea pedida en texto libre guarda su descripción (`product_name_free`) y
 * el N° de parte que escribió quien pidió como atributo libre «N° de Parte».
 * Si Compras la cataloga al armar la OC, la línea gana `product_id` pero
 * conserva ambos: la lógica que deshace ese vínculo al anular la OC necesita el
 * texto libre, así que no se borra. Al mostrarla, en cambio, el repuesto manda:
 * nombre, SKU y su N° de parte, sin el texto libre. El número libre se esconde
 * sólo si es el mismo del repuesto escrito de otra forma («1r 0750» y
 * «1R-0750»); si es otro, se ven los dos, rotulados, porque la diferencia es
 * justo lo que hay que revisar.
 *
 * Sólo presentación: no toca datos.
 */
import { REPUESTO_ATTRIBUTE_NAMES } from "@/lib/validation/repuestos"

/** El rótulo con el que el repuesto dice su N° de parte (el mismo de la ficha del repuesto). */
export const CATALOG_PART_NUMBER_LABEL = "N° de parte"
/** El rótulo del N° de parte que escribió quien pidió, cuando no es el del repuesto. */
export const REQUESTED_PART_NUMBER_LABEL = "N° de parte pedido"

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

/** «1R-0750», «1r 0750» y «1r0750» son el mismo N° de parte. */
function compactPartNumber(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Los atributos de la línea tal como se muestran. Con un repuesto de catálogo,
 * su N° de parte va primero; el libre se esconde si es el mismo y, si no, queda
 * a continuación rotulado como el pedido. Sin repuesto, o con un producto que no
 * es repuesto, quedan como están.
 */
export function withCatalogPartNumber<T extends RecordedAttribute>(
  product: CatalogPartLike | null | undefined,
  recorded: readonly T[] | null | undefined,
): RecordedAttribute[] {
  const attributes = [...(recorded ?? [])]
  if (!product?.isSparePart) return attributes
  const partNumber = product.partNumber?.trim() ?? ""
  const catalogKey = compactPartNumber(partNumber)
  const free = attributes
    .filter((attribute) => isFreePartNumberAttribute(attribute.attributeName))
    .filter((attribute) => attribute.value.trim() !== "" && compactPartNumber(attribute.value) !== catalogKey)
    .map((attribute) => ({ attributeName: REQUESTED_PART_NUMBER_LABEL, value: attribute.value }))
  const rest = attributes.filter((attribute) => !isFreePartNumberAttribute(attribute.attributeName))
  return [
    ...(partNumber ? [{ attributeName: CATALOG_PART_NUMBER_LABEL, value: partNumber }] : []),
    ...free,
    ...rest,
  ]
}

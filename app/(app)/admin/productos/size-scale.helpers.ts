import { normalizeAttributeName } from "@/lib/products/attribute-names"
import { inferEppItemType, sizeFamilyForEppType } from "@/lib/products/epp-item-type"
import type { AttributeMultiValues, SizeFamilyOption } from "./product-form.types"

/**
 * Escala de tallas del asistente de productos.
 *
 * El asistente ofrecía cinco botones «+ Talla», «+ Talla calzado», «+ Talla
 * guantes», «+ Talla inferior», «+ Talla casco» con el mismo peso, y había que
 * saber que un chaleco es «Talla» y un pantalón «Talla inferior». Ahora hay una
 * sola decisión —qué escala— y viene sugerida por el nombre del producto con el
 * mismo vocabulario que el importador (`inferEppItemType`).
 */

/** Escala que sugiere el nombre («Chaleco geólogo» → Ropa), o `null`. */
export function suggestSizeScale(
  productName: string,
  sizeFamilies: readonly SizeFamilyOption[],
): SizeFamilyOption | null {
  const family = sizeFamilyForEppType(inferEppItemType(productName))
  return family ? sizeFamilies.find((option) => option.family === family) ?? null : null
}

/**
 * Escala de un atributo de talla ya cargado. Manda la familia declarada; sin
 * ella, el atributo genérico «Talla» del catálogo importado se lee por el
 * nombre del producto —un botín histórico con «Talla: N41» es calzado, no la
 * escala de ropa que el nombre «Talla» sugeriría—, y recién después por el
 * nombre del atributo.
 */
export function resolveSizeScale(
  attr: Pick<AttributeMultiValues, "name" | "sizeFamily">,
  productName: string,
  sizeFamilies: readonly SizeFamilyOption[],
): SizeFamilyOption | null {
  if (attr.sizeFamily) {
    const declared = sizeFamilies.find((option) => option.family === attr.sizeFamily)
    if (declared) return declared
  }
  const byAttributeName = sizeFamilies.find(
    (option) => normalizeAttributeName(option.attributeName) === normalizeAttributeName(attr.name),
  )
  const isGeneric = normalizeAttributeName(attr.name) === normalizeAttributeName("Talla")
  if (isGeneric) return suggestSizeScale(productName, sizeFamilies) ?? byAttributeName ?? null
  return byAttributeName ?? null
}

/** «Ropa (XS–4XL)», «Casco (Única)». */
export function sizeScaleLabel(option: SizeFamilyOption): string {
  const name = option.label ?? option.attributeName
  const first = option.codes[0]
  const last = option.codes.at(-1)
  if (!first) return name
  return first === last ? `${name} (${first})` : `${name} (${first}–${last})`
}

/** Tallas marcadas al elegir la escala: las típicas, o todas si no declara. */
export function defaultScaleCodes(option: SizeFamilyOption): string[] {
  return option.defaultCodes?.length ? [...option.defaultCodes] : [...option.codes]
}

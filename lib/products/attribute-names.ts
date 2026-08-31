/**
 * Identidad de un nombre de atributo de producto.
 *
 * Vive acá y no en el formulario porque lo necesitan las tres capas que
 * comprueban nombres repetidos —el editor del cliente, `productSchema` y el
 * schema del lote de variantes— y tener una copia por capa ya había producido
 * dos reglas distintas: el lote aceptaba «Tállá» junto a «Talla» y la ficha de
 * producto los rechazaba.
 *
 * Sin dependencias: lo importan tanto componentes de cliente como acciones de
 * servidor.
 */
export function normalizeAttributeName(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
}

/** Nombres normalizados que aparecen más de una vez. */
export function duplicateNormalizedNames(names: readonly string[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const raw of names) {
    const name = normalizeAttributeName(raw)
    if (!name) continue
    if (seen.has(name)) duplicates.add(name)
    seen.add(name)
  }
  return duplicates
}

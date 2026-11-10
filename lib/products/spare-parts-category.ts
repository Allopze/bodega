/**
 * Catálogo de repuestos: la categoría sembrada «Repuestos» (slug `repuestos`,
 * migración 0385) es del catálogo de repuestos y de nadie más.
 *
 * `createSparePartTx` la busca por slug, así que cambiarle el slug deja al
 * catálogo sin categoría; y un producto común (o un EPP) dentro de ella se
 * mezclaría con los repuestos en todo lo que filtra por categoría. Por eso el
 * administrador de productos no la ofrece ni la acepta, y ni su slug ni sus
 * marcas «Es EPP» / «Requiere aprobación de Prevención» se editan: un repuesto
 * no es EPP (CHECK de `products`) y marcarla desviaría los pedidos de repuestos
 * a Prevención.
 *
 * Sin dependencias de base de datos: lo usan las acciones de servidor y los
 * formularios de cliente que esconden la categoría.
 */

/** Mismo valor que `SPARE_PARTS_CATEGORY_SLUG` de `lib/services/spare-parts-catalog.ts`. */
export const SPARE_PARTS_CATEGORY_SLUG = "repuestos"

export const SPARE_PARTS_CATEGORY_RESERVED_MESSAGE =
  "La categoría «Repuestos» es sólo del catálogo de repuestos: los repuestos se crean en Mantención → Catálogo de repuestos. Elige otra categoría."

export const SPARE_PARTS_CATEGORY_SLUG_LOCKED_MESSAGE =
  "El catálogo de repuestos usa el slug «repuestos»: no se puede cambiar."

export const SPARE_PARTS_CATEGORY_FLAGS_LOCKED_MESSAGE =
  "«Es EPP» y «Requiere aprobación de Prevención» no se pueden cambiar en la categoría del catálogo de repuestos."

export function isSparePartsCategory(category: { slug: string } | null | undefined): boolean {
  return category?.slug === SPARE_PARTS_CATEGORY_SLUG
}

/** Las categorías que se ofrecen al crear o editar un producto común. */
export function categoriesForCatalogProducts<T extends { slug: string }>(categories: readonly T[]): T[] {
  return categories.filter((category) => !isSparePartsCategory(category))
}

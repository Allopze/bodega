/**
 * `CAT-003` (auditoría 2026-09-14): la unidad de un producto sale de la lista de
 * unidades, no es texto libre.
 *
 * DOS MITADES, PORQUE SON DOS PROBLEMAS DISTINTOS:
 *
 *  1. **Existir.** Va en base, como FK de `products.unit_of_measure` a
 *     `product_units` (migración 0307). Una validación que sólo viviera acá no
 *     alcanza a los importadores masivos ni a los scripts, que escriben
 *     `products` directamente. La FK alcanza a todo camino de escritura.
 *  2. **Ser elegible.** Desde el 2026-11-12 la lista elegible es fija, en
 *     `PRODUCT_UNITS` (`lib/products/units.ts`), y ya no se administra desde una
 *     pantalla. `product_units` puede guardar además códigos históricos que
 *     algún producto todavía usa: la FK los acepta, pero no se pueden elegir
 *     para una escritura nueva. Eso lo comprueba este módulo.
 *
 * Lo que este módulo no decide: qué pasa con un producto que ya usa una unidad
 * fuera de la lista. Sigue como está; migrarlo a otra unidad cambia el
 * significado de cantidades históricas (stock, recepciones, entregas) y esa
 * conversión no está declarada en ninguna parte de la plataforma.
 */

import { PRODUCT_UNIT_CODES } from "@/lib/products/units"

/** Normaliza igual que `unitOfMeasureSchema`: sin espacios sobrantes, minúscula. */
export function normalizeUnitCode(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ")
}

const ELIGIBLE_UNIT_CODES: ReadonlySet<string> = new Set(PRODUCT_UNIT_CODES)

/** Los códigos que hoy se pueden elegir. */
export function loadActiveUnitCodes(): ReadonlySet<string> {
  return ELIGIBLE_UNIT_CODES
}

export function unitNotInCatalogMessage(unit: string): string {
  return `La unidad "${unit}" no está entre las unidades de medida de la plataforma. Usa una de: ${PRODUCT_UNIT_CODES.join(", ")}.`
}

/**
 * Valida una sola unidad contra la lista y devuelve su forma normalizada.
 * Lanza con un mensaje accionable si no corresponde.
 */
export function resolveActiveUnitCode(unit: string): string {
  const normalized = normalizeUnitCode(unit)
  if (!ELIGIBLE_UNIT_CODES.has(normalized)) throw new Error(unitNotInCatalogMessage(unit))
  return normalized
}

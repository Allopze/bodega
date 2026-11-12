/**
 * Las unidades de medida de la plataforma. Es la única fuente: los formularios,
 * los importadores y la validación de escritura leen esta lista.
 *
 * Antes era un catálogo administrable (`/admin/catalogos-productos`) que nadie
 * movía: 16 unidades, la mitad sin un solo producto. Se fijó en código el
 * 2026-11-12 junto con el retiro de esa pantalla.
 *
 * La tabla `product_units` sigue existiendo, pero sólo como destino de la FK de
 * `products.unit_of_measure`: es lo que impide que un importador o un script
 * escriba una unidad inventada. Agregar una unidad acá exige una migración que
 * la inserte en esa tabla (ver `0387_fixed_product_units.sql`); la prueba
 * `product-units-catalog.test.ts` falla si las dos se separan.
 *
 * Sin dependencias de base de datos: lo importan componentes cliente.
 */

export interface ProductUnit {
  /** Lo que se guarda en `products.unit_of_measure`: minúsculas, sin tildes. */
  readonly code: string
  /** Cómo se muestra. */
  readonly label: string
}

export const PRODUCT_UNITS = [
  { code: "unidad",   label: "Unidad" },
  { code: "par",      label: "Par" },
  { code: "caja",     label: "Caja" },
  { code: "paquete",  label: "Paquete" },
  { code: "set",      label: "Set" },
  { code: "juego",    label: "Juego" },
  { code: "bolsa",    label: "Bolsa" },
  { code: "rollo",    label: "Rollo" },
  { code: "kit",      label: "Kit" },
  { code: "tarro",    label: "Tarro" },
  { code: "bidon",    label: "Bidón" },
  { code: "kg",       label: "Kilogramo" },
  { code: "litro",    label: "Litro" },
  { code: "metro",    label: "Metro" },
  { code: "servicio", label: "Servicio" },
  { code: "dosis",    label: "Dosis" },
] as const satisfies readonly ProductUnit[]

export type ProductUnitCode = (typeof PRODUCT_UNITS)[number]["code"]

/** Los códigos, en el orden en que se ofrecen. */
export const PRODUCT_UNIT_CODES: readonly ProductUnitCode[] = PRODUCT_UNITS.map((unit) => unit.code)

/** Código → rótulo, con la forma que espera `unitLabel()` (`lib/products/unit-label.ts`). */
export const PRODUCT_UNIT_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  PRODUCT_UNITS.map((unit) => [unit.code, unit.label]),
)

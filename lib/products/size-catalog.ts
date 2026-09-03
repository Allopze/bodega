import { compareSizeLabels } from "./product-size"

/**
 * Catálogo canónico de tallas: qué familias existen, con qué códigos y en qué
 * orden se muestran.
 *
 * Vivía como una constante del cliente en el asistente de variantes EPP
 * (`EPP_ATTRIBUTE_PRESETS`) mientras la tabla `size_catalog` —que tiene familia,
 * código, orden y activo/inactivo— estaba vacía y sin un solo lector. Tener el
 * catálogo real en un archivo del bundle significaba que agregar una talla 47
 * era un despliegue, y que `display_order` no lo decidía nadie.
 *
 * Esta constante es la semilla: `syncSizeCatalog` la vuelca en `size_catalog`,
 * y de ahí en adelante la base manda. Los valores son los que el catálogo ya
 * usaba, para no huerfanizar los `product_attributes` existentes.
 */

export interface SizeFamilyDefinition {
  /** Valor que se guarda en `product_attributes.size_family`. */
  family: string
  /** Nombre del atributo que crea el asistente («Talla calzado»). */
  attributeName: string
  codes: readonly string[]
}

export const SIZE_FAMILIES: readonly SizeFamilyDefinition[] = [
  {
    family: "ropa",
    attributeName: "Talla",
    codes: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"],
  },
  {
    family: "calzado",
    attributeName: "Talla calzado",
    codes: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"],
  },
  {
    family: "guantes",
    attributeName: "Talla guantes",
    // Letras y no numeración europea (7-11): es lo que el catálogo actual ya
    // tiene escrito en sus atributos. Cambiarlo huerfanizaría esas variantes.
    codes: ["XS", "S", "M", "L", "XL", "2XL"],
  },
  {
    family: "pantalon",
    attributeName: "Talla inferior",
    // Numeración de cintura. La usa el padrón desde siempre (`size_bottom`) y no
    // estaba en ninguna otra lista: el asistente de variantes no podía crear un
    // pantalón por talla, así que esa talla del padrón nunca tenía con qué cruzar.
    codes: ["28", "30", "32", "34", "36", "38", "40", "42", "44", "46", "48"],
  },
  {
    family: "casco",
    attributeName: "Talla casco",
    // `workers.size_helmet` existe y `workerSizeFieldFor` ya lo mapea, pero sin
    // esta familia ninguna variante podía llevar el atributo y la talla de casco
    // del padrón nunca llegaba a sugerirse. Los códigos son el punto de partida
    // editable desde el asistente, no una lista cerrada.
    codes: ["S", "M", "L", "XL"],
  },
] as const

/**
 * Orden de presentación de una familia. Lo calcula `compareSizeLabels` y no una
 * lista escrita a mano: el `display_order` de la base es un derivado del
 * comparador, no una segunda opinión sobre en qué orden van las tallas.
 */
export function sizeCatalogRows(): Array<{
  family: string
  code: string
  displayOrder: number
}> {
  return SIZE_FAMILIES.flatMap((definition) =>
    [...definition.codes]
      .sort(compareSizeLabels)
      .map((code, index) => ({ family: definition.family, code, displayOrder: index })),
  )
}

/** Definición de una familia por su nombre de atributo («Talla calzado»). */
export function sizeFamilyByAttributeName(attributeName: string): SizeFamilyDefinition | undefined {
  const normalized = attributeName.trim().toLowerCase()
  return SIZE_FAMILIES.find((definition) => definition.attributeName.toLowerCase() === normalized)
}

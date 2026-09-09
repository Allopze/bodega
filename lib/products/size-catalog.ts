import { compareSizeLabels, workerSizeFieldFor, type WorkerSizeField } from "./product-size"

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
    // Letras, no numeración de cintura. Esta familia nació con cinturas 28..48
    // porque `workers.size_bottom` guardaba una, pero la compilación de compras
    // 2022-2026 no deja lugar a duda: 11 productos de pantalón, 4.491 unidades,
    // **ni una sola cintura** — todo S, M, L, XL, 2XL, 3XL.
    //
    // Comparte escala con `ropa` a propósito: lo que distingue a las dos
    // familias no es la escala sino con qué campo del padrón cruzan. Un
    // trabajador puede ser L arriba y XL abajo, y `size_top`/`size_bottom`
    // existen justamente para capturar esa diferencia.
    codes: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"],
  },
  {
    family: "casco",
    attributeName: "Talla casco",
    // `Única` y no S/M/L/XL: manda la base. La migración 0088 sembró esta
    // familia con un solo código y es lo que el catálogo real usa —el casco de
    // obra chileno se ajusta con arnés, no se sizea—, así que la semilla que
    // pedía S/M/L/XL contradecía a la tabla sin que nada resolviera el empate.
    // Como `syncSizeCatalog` es aditivo, dejarlas divergentes significaba que
    // el primer sync iba a ofrecer las cinco juntas en el padrón.
    codes: ["Única"],
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

/**
 * Familia de tallas que alimenta un campo del padrón (`sizeShoe` → `calzado`).
 *
 * Derivada y no escrita a mano: era la cuarta copia del cruce familia ↔ campo
 * del padrón —junto a `SIZE_ATTRIBUTE_FIELDS`, el `attributeName` de acá y un
 * mapa del formulario de trabajadores— y la que más se había separado. Se
 * calcula desde `attributeName` con `workerSizeFieldFor`, que es el dueño de
 * ese cruce, así que agregar una familia ya no exige acordarse de dos listas.
 */
export function sizeFamilyForWorkerField(field: WorkerSizeField): string | null {
  return SIZE_FAMILIES.find((definition) => workerSizeFieldFor(definition.attributeName) === field)
    ?.family ?? null
}

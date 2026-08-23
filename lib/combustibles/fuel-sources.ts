/**
 * Fuentes (`fuel_import_batches.fuente`) que escribe cada integración automática.
 *
 * Existe por el guard de "import ajeno" de las sincronizaciones: antes de crear un
 * lote, cada proveedor busca si ya hay uno para la misma faena y período solapado
 * con OTRA fuente, y si lo encuentra se salta la faena para no duplicar litros y
 * monto sobre una carga manual.
 *
 * Ese guard tiene que excluir a TODOS los proveedores automáticos, no sólo al
 * propio: dos proveedores distintos en la misma faena y mes es el caso normal
 * (una faena carga en Copec y en Aramco), no una duplicación. Cuando el guard
 * sólo conocía las fuentes de Copec, el primer lote de Aramco hacía que la
 * sincronización de Copec devolviera `imported: 0` y se saltara esa faena en
 * silencio.
 *
 * Al sumar un proveedor nuevo hay que agregar sus fuentes acá, o volverá a
 * aparecer el mismo bug con los papeles cambiados.
 */

/** Fuente por producto. Única definición: `copec-sync` construía la etiqueta con
 *  un template aparte, así que editar sólo uno de los dos desalineaba el dedup
 *  (que compara la fuente exacta) del guard (que compara contra la lista). */
const COPEC_TCT_SOURCE_BY_PRODUCT = {
  diesel: "Copec TCT Diesel",
  bluemax: "Copec TCT BlueMax",
} as const

export type CopecTctProduct = keyof typeof COPEC_TCT_SOURCE_BY_PRODUCT

export const COPEC_TCT_SOURCES: string[] = Object.values(COPEC_TCT_SOURCE_BY_PRODUCT)

export function copecTctSource(product: CopecTctProduct): string {
  return COPEC_TCT_SOURCE_BY_PRODUCT[product]
}

export const ARAMCO_SOURCES = ["Aramco Fleet Diesel", "Aramco Fleet AdBlue", "Aramco Fleet Otros"]

/**
 * Etiqueta de `fuente` para un producto de Aramco.
 *
 * `fuel_consumption_records` no tiene columna de producto: igual que en Copec, el
 * producto viaja en `fuente` y por eso hay un lote por (faena, período, producto).
 *
 * El catálogo `products/main` del portal NO es exhaustivo —el único producto que
 * esta cuenta transó, "Aramco ProForce Diesel B" (id 6), no aparece ahí—, así que
 * la clasificación va por nombre y no por id. "Otros" recoge gasolina y kerosene,
 * que la cuenta tiene habilitados pero nunca usó.
 *
 * INVARIANTE: todo lo que devuelva esta función tiene que estar en
 * `ARAMCO_SOURCES`, o el guard de import ajeno vuelve a romperse.
 */
export function aramcoSourceForProduct(productName: string | null | undefined): string {
  const normalized = (productName ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
  if (normalized.includes("BLUE") || normalized.includes("FLUA")) return "Aramco Fleet AdBlue"
  if (normalized.includes("DIESEL")) return "Aramco Fleet Diesel"
  return "Aramco Fleet Otros"
}

/** Unión de las fuentes de todos los proveedores automáticos. Lo que NO está acá
 *  se considera carga manual y sí debe bloquear una sincronización. */
export const AUTOMATED_SOURCES = [...COPEC_TCT_SOURCES, ...ARAMCO_SOURCES]

/**
 * Regla única de identidad de una línea de orden de compra.
 *
 * El nombre operativo —el texto libre que escribió quien levantó la necesidad— manda
 * sobre el nombre de catálogo, porque es el que el proveedor termina copiando en la
 * glosa de su factura. El conciliador ya lo hacía así; la página de la OC hacía lo
 * contrario (catálogo primero) y además le pegaba los atributos de variante, de modo que
 * la misma línea se comparaba con dos strings distintos: la sugerencia de DTE quedaba en
 * "Confianza baja" y mandaba a revisión manual una factura que calzaba exacta.
 *
 * Esto es el valor que se COMPARA. Para mostrar se sigue usando el nombre decorado con
 * variantes (`formatVariantProductName`): son dos cosas distintas y confundirlas fue
 * justamente el origen del problema — `dte-candidates` compara por contención de
 * substring, así que los atributos añadidos alargaban el nombre y rompían el calce.
 *
 * El `id` es el último recurso: nunca calza con nada (`normalizeName` de un uuid no se
 * parece a una glosa), y eso es deliberado — es preferible no proponer vínculo a
 * proponer uno equivocado.
 */
export function resolveOrderItemMatchName(item: {
  id: string
  productNameFree: string | null
  productName: string | null
}): string {
  // `||` y no `??`: una cadena vacía o en blanco no es un nombre, y dejarla pasar dejaba
  // la línea sin nombre comparable en vez de caer al catálogo.
  return item.productNameFree?.trim() || item.productName?.trim() || item.id
}

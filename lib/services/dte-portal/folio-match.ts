/**
 * lib/services/dte-portal/folio-match.ts
 *
 * Normalización del número de documento para cruzar un DTE contra una factura
 * de OC o una carga de combustible.
 *
 * ## Por qué existe
 *
 * El DTE trae el folio como entero (45678). El otro lado lo trae **tipeado a
 * mano**: `purchaseOrderInvoices.invoiceNumber` y `fuelLoads.receiptNumber` son
 * texto libre. Comparar por igualdad exacta de cadena, como se hacía antes,
 * fallaba en todo lo que una persona escribe de forma razonable:
 *
 *   folio 45678  vs  "0045678"    → ceros a la izquierda del talonario
 *   folio 45678  vs  "45.678"     → separador de miles
 *   folio 45678  vs  "F-45678"    → prefijo de serie
 *   folio 45678  vs  "N° 45678"   → rótulo copiado del documento
 *   folio 45678  vs  " 45678 "    → espacios del pegado
 *
 * Ninguna de esas facturas se conciliaba nunca, y el fallo era silencioso: el
 * documento quedaba como "sin vincular" sin decir por qué.
 *
 * ## Qué NO hace
 *
 * No intenta ser listo. Se queda con los dígitos y descarta los ceros a la
 * izquierda; no adivina series, no hace coincidencias parciales ni distancias
 * de edición. Un folio equivocado debe seguir sin cruzar: acá el falso positivo
 * cuesta más que el falso negativo, porque vincula un documento tributario a la
 * factura de otra compra y desde ahí alimenta la conciliación de montos.
 */

/**
 * Reduce un número de documento a su forma comparable: sólo dígitos, sin ceros
 * a la izquierda. Devuelve "" cuando no queda nada comparable, y quien llama
 * debe tratar "" como "no cruza" en vez de como una clave válida.
 */
export function normalizeFolio(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  const digits = String(value).replace(/\D/g, "")
  const trimmed = digits.replace(/^0+/, "")
  return trimmed
}

/**
 * Expresión SQL equivalente a `normalizeFolio`, para acotar la consulta antes
 * de confirmar en memoria.
 *
 * Se usa sólo como **prefiltro**: la comparación que decide es la de
 * `normalizeFolio` en JS, así que una divergencia entre ambas sólo puede traer
 * filas de más (que JS descarta), nunca perder una coincidencia. Mantenerlas
 * idénticas es deseable, pero no es lo que sostiene la correctitud.
 */
export const NORMALIZED_FOLIO_SQL = `ltrim(regexp_replace(coalesce(%COLUMN%, ''), '[^0-9]', '', 'g'), '0')`

/** Clave de cruce: exige folio Y RUT, porque el folio no es único global. */
export function folioRutKey(folio: string | number, cleanedRut: string): string {
  return `${normalizeFolio(folio)}|${cleanedRut}`
}

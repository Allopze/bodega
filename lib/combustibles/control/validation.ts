/**
 * Validaciones puras del control de combustible: sellos y fechas de relleno.
 *
 * Las planillas históricas rellenan con valores inventados lo que en terreno no
 * se anotó: sellos «777777», «000000» o la fecha serial cero de Excel
 * (1899-12-30). No son datos, son huecos disfrazados; la proyección los marca
 * como `filler_value` para que un revisor los vea en vez de que entren en
 * silencio a la cadena de sellos o a un mes de 1899.
 */

/**
 * Forma canónica de un número de sello para comparar la cadena: sin espacios,
 * en mayúsculas y sin ceros a la izquierda («0504» y «504» son el mismo sello
 * físico; la planilla los escribe de las dos maneras). Un sello hecho solo de
 * ceros queda como «0». Vacío → null.
 */
export function normalizeSeal(value: string | null | undefined): string | null {
  if (value == null) return null
  const compact = value.replace(/\s+/g, "").toUpperCase()
  if (compact === "") return null
  const stripped = compact.replace(/^0+/, "")
  return stripped === "" ? "0" : stripped
}

/**
 * Sello de relleno: un mismo dígito repetido cinco o más veces (777777,
 * 666666, 000000) o un sello que es solo ceros («0»). Ningún proveedor numera
 * sellos así; son lo que se digita cuando el sello no se anotó.
 */
export function isFillerSealNumber(value: string): boolean {
  const compact = value.replace(/\s+/g, "")
  if (compact === "") return false
  if (/^0+$/.test(compact)) return true
  return /^(\d)\1{4,}$/.test(compact)
}

/** Primer año creíble de una carga: todo lo anterior es una fecha de relleno. */
export const MIN_CREDIBLE_YEAR = 1990

/**
 * Fecha de relleno («YYYY-MM-DD» civil): año anterior a 1990, típicamente la
 * fecha serial cero de Excel 1899-12-30. Una fecha que no se puede leer
 * también cuenta como relleno: no hay día real detrás.
 */
export function isFillerDate(plainDate: string): boolean {
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(plainDate.trim())
  if (!match) return true
  return Number(match[1]) < MIN_CREDIBLE_YEAR
}

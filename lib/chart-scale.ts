/**
 * Escala de ejes para gráficos con varios paneles o varias series que comparten tope.
 *
 * Con un eje compartido (small multiples, la diagonal de un gráfico de dispersión)
 * el tope tiene que ser común y legible: no el máximo exacto de los datos (el punto
 * más alto quedaría pegado al borde) ni uno que deje la mitad del gráfico vacío.
 */

/** Margen contra el error de coma flotante en un valor que cae justo en un tope redondo. */
const EPSILON = 1e-9

/** Tope redondo y legible para un eje que debe cubrir `value`: 1, 2, 4, 5, 8 o 10 × 10ⁿ. `10` si no hay nada que cubrir. */
export function niceAxisMax(value: number): number {
  if (!(value > 0)) return 10
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const factor of [1, 2, 4, 5, 8, 10]) {
    if (factor * magnitude >= value - EPSILON) return factor * magnitude
  }
  return 10 * magnitude
}

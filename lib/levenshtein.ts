/**
 * Distancia de edición entre dos cadenas.
 *
 * La comparten el matcher de la importación TAE (códigos y nombres con errores
 * de tipeo) y la sugerencia "¿quisiste decir…?" de la pantalla 404.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const rows: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) rows[i]![0] = i
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i]![j] = a[i - 1] === b[j - 1]
        ? rows[i - 1]![j - 1]!
        : 1 + Math.min(rows[i - 1]![j]!, rows[i]![j - 1]!, rows[i - 1]![j - 1]!)
    }
  }
  return rows[a.length]![b.length]!
}

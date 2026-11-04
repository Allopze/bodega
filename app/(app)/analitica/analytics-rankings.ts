import type { RankedListItem } from "@/components/ui/ranked-list"
import { formatPercent } from "@/lib/utils"

/**
 * Forma de los rankings de Analítica (faenas, vehículos, gasto por tipo). Antes eran barras
 * horizontales con un color por barra —el color no codificaba nada— y ahora son `RankedList`
 * de un solo tono (CHART-033). Acá viven sólo las partes puras: pasar filas del servicio a
 * ítems y la frase que responde «¿quién gasta más?».
 */

export interface RankingInput {
  key: string
  label: string
  value: number
  detail?: string
  href?: string
}

/** Ítems de `RankedList`: de mayor a menor, sin filas en cero (no son ranking) y en pesos enteros. */
export function rankingItems(rows: readonly RankingInput[]): RankedListItem[] {
  return rows
    .filter((row) => row.value > 0)
    .map((row) => ({ ...row, value: Math.round(row.value) }))
    .sort((a, b) => b.value - a.value)
}

/**
 * «X lidera con $N: P% de lo listado». El porcentaje es contra la suma de las filas que se
 * muestran, que es contra lo que `RankedList` calcula el suyo: decir «del gasto total» sería falso
 * cuando el ranking recorta a las diez primeras (`of` lo cambia cuando la lista SÍ es el total, como el
 * reparto por tipo). `gender` concuerda «la única» / «el único».
 */
export function rankingLeaderSummary(
  items: readonly RankedListItem[],
  formatMoney: (value: number) => string,
  { gender = "a", of = "de lo listado" }: { gender?: "a" | "o"; of?: string } = {},
): string {
  const [leader] = items
  if (!leader) return ""
  if (items.length === 1) return `${leader.label} es ${gender === "a" ? "la única" : "el único"} con gasto: ${formatMoney(leader.value)}.`
  const total = items.reduce((sum, item) => sum + item.value, 0)
  return `${leader.label} lidera con ${formatMoney(leader.value)}: ${formatPercent(Math.round((leader.value / total) * 100), 0)} ${of}.`
}

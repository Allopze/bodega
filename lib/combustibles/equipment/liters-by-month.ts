import { addMonths } from "@/lib/utils"
import type { EquipmentFileLitersMonth } from "./types"

/** Cuántos meses muestra «Litros por mes» en la ficha del equipo: el del fin del período y los 11 anteriores. */
export const LITERS_BY_MONTH_COUNT = 12

/**
 * Las `count` claves "YYYY-MM" que terminan en `endMonth` (incluido), de la más
 * antigua a la más reciente.
 *
 * Se parte del día 1 de `endMonth`: así el desfase de meses nunca cae en un día
 * que el mes de destino no tiene (un 31 de marzo menos un mes no existe como
 * «31 de febrero»). Y como se suma sobre el mes, el cambio de año sale solo.
 */
export function litersMonthKeys(endMonth: string, count: number = LITERS_BY_MONTH_COUNT): string[] {
  return Array.from({ length: count }, (_, index) => addMonths(`${endMonth}-01`, index - (count - 1)).slice(0, 7))
}

/**
 * Los últimos `count` meses que terminan en `endMonth`, con CEROS donde no hubo
 * cargas: un gráfico de barras con meses salteados no se lee como «ese mes no se
 * cargó» sino como un eje roto. `rows` trae una fila por mes con cargas (así
 * sale agrupada de SQL), en cualquier orden; lo que cae fuera de la ventana se
 * descarta.
 */
export function fillLitersByMonth(
  endMonth: string,
  rows: readonly EquipmentFileLitersMonth[],
  count: number = LITERS_BY_MONTH_COUNT,
): EquipmentFileLitersMonth[] {
  const byMonth = new Map(rows.map((row) => [row.month, row]))
  return litersMonthKeys(endMonth, count).map((month) => {
    const row = byMonth.get(month)
    return { month, liters: row?.liters ?? 0, loads: row?.loads ?? 0 }
  })
}

import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { MONTH_NAMES, todayInChile } from "@/lib/utils"
import { monthText } from "./format"

type PeriodLike = Pick<ResolvedFuelPeriod, "isWholeMonths" | "inLabel" | "monthKeys">

/** «octubre» o «octubre de 2025» (si no es el año en curso). */
function monthName(key: string, today = todayInChile()): string {
  const [year = "", month = ""] = key.split("-")
  const name = MONTH_NAMES[Number(month) - 1] ?? key
  return year === today.slice(0, 4) ? name : `${name} de ${year}`
}

/**
 * La frase de período de una pantalla que mide por mes completo: «en octubre»,
 * «en el 4.º trimestre»; si el período es una semana o un rango, los meses
 * completos que toca («en octubre», «entre Sep 2026 y Oct 2026»).
 */
export function wholeMonthsPhrase(period: PeriodLike, today = todayInChile()): string {
  if (period.isWholeMonths) return `en ${period.inLabel}`
  const first = period.monthKeys[0]
  const last = period.monthKeys[period.monthKeys.length - 1]
  if (!first || !last) return `en ${period.inLabel}`
  return first === last ? `en ${monthName(first, today)}` : `entre ${monthText(first)} y ${monthText(last)}`
}

/** El aviso de que la cuadratura se midió con meses completos; `null` si el período ya lo es. */
export function wholeMonthsNote(period: PeriodLike & Pick<ResolvedFuelPeriod, "label">, subject = "La cuadratura"): string | null {
  if (period.isWholeMonths) return null
  const first = period.monthKeys[0]
  const last = period.monthKeys[period.monthKeys.length - 1]
  const months = first && last && first !== last ? `se muestran los meses completos de ${monthText(first)} a ${monthText(last)}` : `se muestra el mes completo de ${first ? monthText(first) : period.label}`
  return `${subject} se mide por mes completo: con «${period.label}» ${months}.`
}

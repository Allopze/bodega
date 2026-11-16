import { monthNameOfKey } from "@/lib/combustibles/panel/format"
import { todayInChile } from "@/lib/utils"

const DAY_MS = 86_400_000

/** «enero 2026»: el mes del dato siempre con su año, para que un caso viejo no parezca de este mes. */
export function dataMonthLabel(dataMonth: string): string {
  return `${monthNameOfKey(dataMonth)} ${dataMonth.slice(0, 4)}`
}

/** «enero a marzo 2026», «diciembre 2025 a enero 2026» o un solo mes: de cuándo son los datos de un grupo. */
export function dataMonthRangeLabel(first: string, last: string): string {
  if (first === last) return dataMonthLabel(first)
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${monthNameOfKey(first)} a ${dataMonthLabel(last)}`
    : `${dataMonthLabel(first)} a ${dataMonthLabel(last)}`
}

/** Cuánto espera: «Hoy», «1 día», «12 días». */
export function waitLabel(since: string, today: string): string {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${todayInChile(since)}T00:00:00Z`)) / DAY_MS)
  if (days <= 0) return "Hoy"
  return days === 1 ? "1 día" : `${days} días`
}

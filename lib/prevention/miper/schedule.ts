/**
 * Agenda de ocurrencias del Programa de Trabajo (§7.4 del spec F2).
 *
 * Se trabaja con fechas civiles `AAAA-MM-DD` sobre `Date.UTC`, nunca con la zona
 * local: una agenda es un contrato de calendario, no un instante, y la zona del
 * navegador o del servidor no debe correr una ocurrencia al día anterior.
 */

export type ProgramScheduleKind = "once" | "monthly" | "quarterly" | "semiannual" | "annual"

/** Meses entre ocurrencias para cada frecuencia recurrente. */
const STEP_MONTHS: Record<Exclude<ProgramScheduleKind, "once">, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseCivilDate(value: string): Date {
  const match = ISO_DATE_RE.exec(value)
  if (!match) throw new Error(`Fecha civil inválida: ${value}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`Fecha civil inválida: ${value}`)
  }
  return date
}

/** Marca de tiempo UTC del último día del mes indicado (`month` es 0-based). */
function lastDayOfMonth(year: number, month: number): number {
  return Date.UTC(year, month + 1, 0)
}

function toCivilDate(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10)
}

/**
 * Fechas de ocurrencia para una actividad: la primera ≥ `startsOn`, la última
 * ≤ `periodEnd`, sin duplicados y ordenadas.
 *
 * Las frecuencias mensuales caen siempre en el **último día del mes** (mes
 * calendario completo, como el resto de fechas civiles del repo); el ancla es el
 * mes de `startsOn` y de ahí se avanza por la frecuencia. `once` devuelve sólo
 * `startsOn`. Si `startsOn` es posterior a `periodEnd` la lista es vacía.
 */
export function occurrenceDates(input: {
  scheduleKind: ProgramScheduleKind
  startsOn: string
  periodEnd: string
}): string[] {
  const start = parseCivilDate(input.startsOn)
  const end = parseCivilDate(input.periodEnd)
  const endMillis = end.getTime()
  if (start.getTime() > endMillis) return []
  if (input.scheduleKind === "once") return [input.startsOn]

  const step = STEP_MONTHS[input.scheduleKind]
  const dates: string[] = []
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth()

  for (;;) {
    const dueMillis = lastDayOfMonth(year, month)
    if (dueMillis > endMillis) break
    if (dueMillis >= start.getTime()) dates.push(toCivilDate(dueMillis))
    month += step
    year += Math.floor(month / 12)
    month %= 12
  }

  return dates
}

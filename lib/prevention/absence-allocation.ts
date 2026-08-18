/**
 * Reparto de días perdidos por mes calendario.
 *
 * El DS 44 atribuye los días de ausencia al período en que existió la
 * incapacidad, no al mes del accidente. Importa especialmente porque la tasa de
 * gravedad se calcula por SEMESTRE: un accidente del 25 de junio con 45 días de
 * reposo cargaba los 45 al primer semestre y dejaba el segundo en cero.
 */

export interface AbsencePeriodInput {
  startDate: string
  /** Nulo = reposo vigente: se corta en `openEndedUntil`. */
  endDate: string | null
}

export interface MonthlyAbsenceAllocation {
  year: number
  month: number
  days: number
}

const DAY_MS = 86_400_000

function parsePlainDate(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed)) throw new Error(`Fecha de ausencia inválida: ${value}`)
  return parsed
}

/**
 * Días de un período, ambos extremos inclusive: del 1 al 1 es un día, no cero.
 * Un reposo abierto se contabiliza hasta `openEndedUntil` (normalmente hoy), y
 * volverá a crecer en la corrida siguiente.
 */
export function allocateAbsenceDaysByMonth(
  periods: AbsencePeriodInput[],
  openEndedUntil: string,
): MonthlyAbsenceAllocation[] {
  const byKey = new Map<string, MonthlyAbsenceAllocation>()
  const cutoff = parsePlainDate(openEndedUntil)

  for (const period of periods) {
    const start = parsePlainDate(period.startDate)
    const end = period.endDate ? parsePlainDate(period.endDate) : cutoff
    if (end < start) continue

    for (let cursor = start; cursor <= end; cursor += DAY_MS) {
      const date = new Date(cursor)
      const year = date.getUTCFullYear()
      const month = date.getUTCMonth() + 1
      const key = `${year}-${month}`
      const current = byKey.get(key)
      if (current) current.days += 1
      else byKey.set(key, { year, month, days: 1 })
    }
  }

  return [...byKey.values()].sort((a, b) => (a.year - b.year) || (a.month - b.month))
}

/** Total de días de los períodos, para derivar `absenceDays` sin duplicar reglas. */
export function totalAbsenceDays(periods: AbsencePeriodInput[], openEndedUntil: string): number {
  return allocateAbsenceDaysByMonth(periods, openEndedUntil).reduce((total, item) => total + item.days, 0)
}

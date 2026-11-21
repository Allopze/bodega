import { formatDate, todayInChile } from "@/lib/utils"

/**
 * Uso personal de equipos: los días en que el dueño se llevó el equipo no suman
 * plata, litros, km, horas ni ralentí en ningún agregado de gestión. Esta es la
 * versión en memoria de la regla; la de SQL está en `./personal-use-sql.ts` y
 * ninguna consulta reimplementa el cruce.
 *
 * Días = día calendario de Chile, texto `YYYY-MM-DD`, ambos extremos inclusivos.
 * Un período abierto (`endedOn` nulo) cubre hasta hoy.
 */
export type PersonalUsePeriod = {
  id: string
  vehicleId: string
  startedOn: string
  endedOn: string | null
  note: string | null
}

/** Períodos por `vehicleId`. */
export type PersonalUseIndex = ReadonlyMap<string, readonly PersonalUsePeriod[]>

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

/** `YYYY-MM-DD` que existe en el calendario (rechaza `2026-02-30`). */
export function isPlainDate(value: string): boolean {
  const match = PLAIN_DATE.exec(value)
  if (!match) return false
  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d)
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS
}

export function indexPersonalUse(periods: readonly PersonalUsePeriod[]): PersonalUseIndex {
  const index = new Map<string, PersonalUsePeriod[]>()
  for (const period of periods) {
    const list = index.get(period.vehicleId)
    if (list) list.push(period)
    else index.set(period.vehicleId, [period])
  }
  return index
}

function endOf(period: PersonalUsePeriod, today: string): string {
  return period.endedOn ?? today
}

export function isPersonalUseDay(index: PersonalUseIndex, vehicleId: string, day: string, today?: string): boolean {
  const periods = index.get(vehicleId)
  if (!periods) return false
  const cap = today ?? todayInChile()
  return periods.some((p) => p.startedOn <= day && day <= endOf(p, cap))
}

/** Días de uso personal del equipo dentro de `from..to` (inclusivos). */
export function personalUseDaysIn(index: PersonalUseIndex, vehicleId: string, from: string, to: string, today?: string): number {
  const periods = index.get(vehicleId)
  if (!periods || to < from) return 0
  const cap = today ?? todayInChile()
  let days = 0
  for (const p of periods) {
    const start = p.startedOn > from ? p.startedOn : from
    const periodEnd = endOf(p, cap)
    const end = periodEnd < to ? periodEnd : to
    if (end >= start) days += dayNumber(end) - dayNumber(start) + 1
  }
  return days
}

/**
 * Fracción de `from..to` que queda fuera del uso personal, en [0, 1]. Se mide
 * sobre los días ya transcurridos (`to` topado en hoy): un registro del mes en
 * curso (Copec lo reescribe a la fecha cada día) trae el monto hasta hoy, no del
 * mes entero.
 */
export function keptFraction(index: PersonalUseIndex, vehicleId: string, from: string, to: string, today?: string): number {
  const cap = today ?? todayInChile()
  const end = to < cap ? to : cap
  if (end < from) return 1
  const length = dayNumber(end) - dayNumber(from) + 1
  const kept = 1 - personalUseDaysIn(index, vehicleId, from, end, cap) / length
  return Math.min(1, Math.max(0, kept))
}

function describePeriod(period: { startedOn: string; endedOn: string | null }): string {
  return `${formatDate(period.startedOn)} → ${period.endedOn ? formatDate(period.endedOn) : "(en curso)"}`
}

/**
 * Valida un período contra los demás del mismo equipo (sin incluirse a sí
 * mismo). Devuelve el mensaje para el usuario o `null` si es válido.
 */
export function validatePersonalUsePeriod(
  input: { startedOn: string; endedOn: string | null },
  others: readonly PersonalUsePeriod[],
  today: string,
): string | null {
  const { startedOn, endedOn } = input
  if (!isPlainDate(startedOn)) return "Indica una fecha de inicio válida."
  if (endedOn !== null && !isPlainDate(endedOn)) return "Indica una fecha de término válida."
  if (startedOn > today) return "El inicio no puede ser una fecha futura."
  if (endedOn !== null && endedOn > today) {
    return "El término no puede ser una fecha futura. Déjalo vacío si el equipo aún no vuelve."
  }
  if (endedOn !== null && endedOn < startedOn) return "El término no puede ser anterior al inicio."
  const end = endedOn ?? "9999-12-31"
  const clash = others.find((o) => o.startedOn <= end && (o.endedOn ?? "9999-12-31") >= startedOn)
  if (clash) return `Se cruza con otro uso personal de este equipo (${describePeriod(clash)}).`
  return null
}

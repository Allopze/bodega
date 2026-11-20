import { addDaysToPlainDate } from "@/lib/utils"
import type { HourKey, PlainDate, SegmentType, ShiftWindow } from "./types"

/**
 * Horas de reloj en Chile para turnos y tramos de VisionLink.
 *
 * Chile continental cambia de horario en horas exactas (UTC−3 / UTC−4), así que
 * cada límite de hora local cae en un límite de hora UTC: un tramo se corta en
 * las horas UTC y cada pedazo se rotula con la hora de Chile en que empieza.
 * El día en que se atrasa el reloj, las 23:00 ocurren dos veces y ambas suman en
 * la misma clave; el día en que se adelanta, las 00:00 no existen y no reciben nada.
 */

const HOUR_MS = 3_600_000

const CHILE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
})

/** La hora de Chile (día y hora de reloj) que muestra un instante. */
export function chileHourKey(instantMs: number): HourKey {
  const parts = Object.fromEntries(CHILE_PARTS.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

/** Clave estable de una hora: `"2026-11-18|06"`. */
export function hourKeyId(key: HourKey): string {
  return `${key.day}|${String(key.hour).padStart(2, "0")}`
}

/** Las horas de reloj que cubre un turno, en orden; uno nocturno sigue en el día siguiente. */
export function shiftHourKeys(shift: ShiftWindow): HourKey[] {
  const end = shift.endHour > shift.startHour ? shift.endHour : shift.endHour + 24
  const keys: HourKey[] = []
  for (let hour = shift.startHour; hour < end; hour++) {
    keys.push(hour < 24 ? { day: shift.shiftDate, hour } : { day: addDaysToPlainDate(shift.shiftDate, 1), hour: hour - 24 })
  }
  return keys
}

/**
 * Instante (ms) de un texto «UTC» de VisionLink. La API lo entrega sin la `Z`
 * (`2026-11-20T14:32:51`) y `Date.parse` lo leería como hora local del servidor:
 * sin `Z` ni desfase, se lee como UTC. Un texto inválido devuelve `NaN`.
 */
export function parseVisionLinkUtc(value: string): number {
  const trimmed = value.trim()
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
  return Date.parse(hasZone ? trimmed : `${trimmed}Z`)
}

/**
 * Reparte un tramo entre las horas de reloj de Chile que atraviesa: uno de 05:50 a
 * 06:20 da 600 s a las 05 y 1200 s a las 06. Un tramo inválido o vacío no da nada.
 */
export function splitSegmentByChileHour(segment: { startUtc: string; endUtc: string; type: SegmentType }): Array<HourKey & { type: SegmentType; seconds: number }> {
  const start = parseVisionLinkUtc(segment.startUtc)
  const end = parseVisionLinkUtc(segment.endUtc)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
  const pieces: Array<HourKey & { type: SegmentType; seconds: number }> = []
  let cursor = start
  while (cursor < end) {
    const boundary = Math.min(end, Math.floor(cursor / HOUR_MS) * HOUR_MS + HOUR_MS)
    const key = chileHourKey(cursor)
    const last = pieces[pieces.length - 1]
    const seconds = (boundary - cursor) / 1000
    if (last && last.day === key.day && last.hour === key.hour) last.seconds += seconds
    else pieces.push({ ...key, type: segment.type, seconds })
    cursor = boundary
  }
  return pieces
}

/**
 * Instante (ms) en que termina una hora de reloj de Chile. Si la hora ocurre dos
 * veces (se atrasa el reloj), cuenta la segunda; si no existe (se adelanta), es
 * el instante del salto.
 */
export function hourEndInstant(key: HourKey): number {
  const [year, month, day] = key.day.split("-").map(Number) as [number, number, number]
  const wall = Date.UTC(year, month - 1, day, key.hour)
  // Hora de Chile = UTC − 3 o − 4: esa hora local empieza entre wall + 2 h y wall + 5 h.
  let lastStart: number | null = null
  for (let offset = 2; offset <= 5; offset++) {
    const candidate = wall + offset * HOUR_MS
    const shown = chileHourKey(candidate)
    if (shown.day === key.day && shown.hour === key.hour) lastStart = candidate
  }
  return lastStart === null ? wall + 4 * HOUR_MS : lastStart + HOUR_MS
}

/** Días civiles de `from` a `to`, ambos incluidos. */
export function daysBetween(from: PlainDate, to: PlainDate): PlainDate[] {
  const days: PlainDate[] = []
  for (let day = from; day <= to; day = addDaysToPlainDate(day, 1)) days.push(day)
  return days
}

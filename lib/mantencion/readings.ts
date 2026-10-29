import { formatDate } from "@/lib/utils"
import { formatNumber, formatReading } from "./format"
import type { MantReading, MantUnit } from "./types"

/**
 * Lecturas del equipo (reglas 1, 2 y 3). Las lecturas que llegan aquí son
 * SIEMPRE vigentes: quien llama excluye los registros anulados.
 */

/** Días entre dos fechas `YYYY-MM-DD` (b − a), sin husos horarios. */
export function daysBetween(a: string, b: string): number {
  const toUtc = (value: string) => {
    const [y = 0, m = 1, d = 1] = value.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}

/**
 * Regla 1: la lectura vigente es la del registro con mayor fecha de trabajo; si
 * no hay registros, la lectura inicial de la ficha. Con dos registros del mismo
 * día gana la lectura mayor (el odómetro no retrocede dentro del día).
 */
export function currentReading(readings: readonly MantReading[], initial: MantReading | null): MantReading | null {
  let best: MantReading | null = null
  for (const reading of readings) {
    if (!best || reading.date > best.date || (reading.date === best.date && reading.value > best.value)) best = reading
  }
  return best ?? initial
}

export interface ReadingBounds {
  /** Última lectura con fecha ≤ F (incluida la inicial). */
  previous: MantReading | null
  /** Primera lectura con fecha > F. */
  next: MantReading | null
}

export function readingBounds(readings: readonly MantReading[], initial: MantReading | null, workDate: string): ReadingBounds {
  const all = initial ? [initial, ...readings] : [...readings]
  let previous: MantReading | null = null
  let next: MantReading | null = null
  for (const reading of all) {
    if (reading.date <= workDate) {
      if (!previous || reading.date > previous.date || (reading.date === previous.date && reading.value > previous.value)) previous = reading
    } else if (!next || reading.date < next.date || (reading.date === next.date && reading.value < next.value)) {
      next = reading
    }
  }
  return { previous, next }
}

export type ReadingCheck =
  | { ok: true; previous: MantReading | null; jump: ReadingJump | null }
  | { ok: false; message: string; conflict: MantReading }

export interface ReadingJump {
  delta: number
  /** «Son 363.000 km más que la última vez. ¿Está bien?» */
  question: string
}

/** Umbrales de la regla 3. */
export const JUMP_LIMITS = {
  km: { absolute: 5_000, perDay: 1_500 },
  h: { absolute: 300, perDay: 24 },
} as const satisfies Record<MantUnit, { absolute: number; perDay: number }>

/**
 * Regla 3: hay salto si el aumento respecto de la lectura anterior supera el
 * absoluto de la unidad, o si supera el máximo diario entre ambas fechas (un
 * mismo día cuenta como un día).
 */
export function detectJump(previous: MantReading | null, value: number, workDate: string, unit: MantUnit): ReadingJump | null {
  if (!previous) return null
  const delta = value - previous.value
  if (delta <= 0) return null
  const limits = JUMP_LIMITS[unit]
  const days = Math.max(1, daysBetween(previous.date, workDate))
  if (delta <= limits.absolute && delta / days <= limits.perDay) return null
  return { delta, question: `Son ${formatNumber(delta)} ${unit} más que la última vez. ¿Está bien?` }
}

/**
 * Regla 2: con fecha F, la lectura debe ser ≥ la última vigente con fecha ≤ F y
 * ≤ la primera vigente con fecha > F. El mensaje dice qué lectura choca y de
 * qué fecha. Si pasa, devuelve además el salto de la regla 3, si lo hay.
 */
export function checkReading(input: {
  value: number
  workDate: string
  unit: MantUnit
  readings: readonly MantReading[]
  initial: MantReading | null
}): ReadingCheck {
  const { previous, next } = readingBounds(input.readings, input.initial, input.workDate)
  if (previous && input.value < previous.value) {
    return {
      ok: false,
      conflict: previous,
      message: `Es menor que la lectura de ${formatReading(previous.value, input.unit)} del ${formatDate(previous.date)} (${previous.source}). Revisa el número o la fecha.`,
    }
  }
  if (next && input.value > next.value) {
    return {
      ok: false,
      conflict: next,
      message: `Es mayor que la lectura de ${formatReading(next.value, input.unit)} registrada después, el ${formatDate(next.date)} (${next.source}). Revisa el número o la fecha.`,
    }
  }
  return { ok: true, previous, jump: detectJump(previous, input.value, input.workDate, input.unit) }
}

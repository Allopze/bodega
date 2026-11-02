import { toLocalInputValue } from "@/lib/utils"

/** El reloj del teléfono puede ir unos minutos adelantado: una hora «de ahora» escrita a mano no es futura por eso. */
export const FUTURE_TOLERANCE_MS = 5 * 60_000

/** ¿Esa hora está más allá de ahora (con la tolerancia)? */
export function isFuture(when: Date, now: number = Date.now()): boolean {
  return when.getTime() > now + FUTURE_TOLERANCE_MS
}

/** Valor para el `max` de un `<input type="datetime-local">`: ahora más la tolerancia. */
export function nowLocalMax(now: number = Date.now()): string {
  return toLocalInputValue(new Date(now + FUTURE_TOLERANCE_MS))
}

/** Valor inicial de un `<input type="datetime-local">`: ahora, en hora local. */
export function nowLocalValue(now: number = Date.now()): string {
  return toLocalInputValue(new Date(now))
}

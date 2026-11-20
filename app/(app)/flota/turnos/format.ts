import { VALUE_MISSING } from "@/lib/utils"

/**
 * Cifras de «Turnos y ralentí»: coma decimal (es-CL), horas y porcentajes con un decimal para que las
 * columnas alineen. Los porcentajes llegan como fracción (0,3 = 30 %), como los devuelve el cálculo.
 */

const ONE_DECIMAL = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function formatHoursValue(hours: number): string {
  return Number.isFinite(hours) ? ONE_DECIMAL.format(hours) : VALUE_MISSING
}

/** `12,3%`; sin dato, «—». */
export function formatIdlePct(fraction: number | null | undefined): string {
  return fraction === null || fraction === undefined || !Number.isFinite(fraction) ? VALUE_MISSING : `${ONE_DECIMAL.format(fraction * 100)}%`
}

/** La meta se edita y se dice como entero: `30%`. */
export function formatTargetPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`
}

/** `22–06`: el horario de un turno. */
export function shiftRangeLabel(startHour: number, endHour: number): string {
  return `${String(startHour).padStart(2, "0")}–${String(endHour).padStart(2, "0")}`
}

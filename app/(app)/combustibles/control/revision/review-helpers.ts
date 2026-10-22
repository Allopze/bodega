import { PERFORMANCE_UNIT_LABELS, STAT_MISSING, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { formatQty } from "@/lib/utils"

/** Nota obligatoria de toda decisión: el servidor aplica el mismo mínimo. */
export const MIN_DECISION_NOTE_LENGTH = 10
export const MAX_DECISION_NOTE_LENGTH = 500

/** Mensaje de error de la nota, o `null` si es válida. */
export function validateDecisionNote(note: string): string | null {
  const trimmed = note.trim()
  if (trimmed.length < MIN_DECISION_NOTE_LENGTH) {
    return `Escribe al menos ${MIN_DECISION_NOTE_LENGTH} caracteres para dejar constancia del motivo.`
  }
  if (trimmed.length > MAX_DECISION_NOTE_LENGTH) return `La nota no puede superar ${MAX_DECISION_NOTE_LENGTH} caracteres.`
  return null
}

/** «12,3 km/L»; sin valor o sin unidad, el marcador de dato faltante. */
export function formatPerformance(value: number | null, unit: PerformanceUnit | null): string {
  if (value === null || unit === null) return STAT_MISSING
  return `${formatQty(value, undefined, { maximumFractionDigits: 2 })} ${PERFORMANCE_UNIT_LABELS[unit]}`
}

/** Lectura de medidor con su unidad: km para odómetro, h para horómetro. */
export function formatMeterReading(value: number | null, meterType: "odometer" | "hour_meter" | null): string {
  if (value === null) return STAT_MISSING
  return `${formatQty(value, undefined, { maximumFractionDigits: 1 })} ${meterType === "hour_meter" ? "h" : "km"}`
}

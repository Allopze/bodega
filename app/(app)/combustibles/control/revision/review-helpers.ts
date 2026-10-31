import { PERFORMANCE_UNIT_LABELS, STAT_MISSING, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import { formatQty } from "@/lib/utils"

export { MAX_DECISION_NOTE_LENGTH, MIN_DECISION_NOTE_LENGTH, validateDecisionNote } from "@/lib/combustibles/inbox/reasons"

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

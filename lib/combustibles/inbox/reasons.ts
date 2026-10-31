import {
  FLAG_DECISION_COPY,
  FLAG_REASON_LABELS,
  FLAG_REASONS,
  PERFORMANCE_UNIT_LABELS,
  type FlagReason,
  type PerformanceUnit,
} from "@/lib/combustibles/control/contracts"
import { formatDateTime, formatQty } from "@/lib/utils"

/**
 * Los motivos de una carga por decidir, puestos en palabras. Módulo puro: lo
 * usan la consulta de la bandeja (servidor) y la hoja de decisión (cliente).
 */

/**
 * Qué motivo manda cuando una carga trae varios. Define el título de la fila y
 * los rótulos de los botones de decisión: «Es la misma carga» sólo tiene
 * sentido si el motivo principal es la duplicada, y «Sin ficha» va primero
 * porque sin equipo no hay serie contra la que juzgar lo demás.
 */
export const FLAG_REASON_PRIORITY: readonly FlagReason[] = [
  "unknown_vehicle",
  "duplicate",
  "meter_regression",
  "over_capacity",
  "late_entry",
  "filler_value",
  "implausible",
  "outlier",
]

/** `flag_reasons` es jsonb libre: sólo pasan los motivos que el contrato conoce, en el orden del contrato. */
export function knownFlagReasons(raw: unknown): FlagReason[] {
  if (!Array.isArray(raw)) return []
  const set = new Set(raw.filter((item): item is string => typeof item === "string"))
  return FLAG_REASONS.filter((reason) => set.has(reason))
}

export function primaryFlagReason(codes: readonly string[]): FlagReason | null {
  for (const reason of FLAG_REASON_PRIORITY) if (codes.includes(reason)) return reason
  return null
}

const NEUTRAL_COPY = FLAG_DECISION_COPY.meter_regression

/** Rótulos y efecto de «Cuenta / No cuenta» según el motivo principal. */
export function decisionCopyFor(codes: readonly string[]): (typeof FLAG_DECISION_COPY)[FlagReason] {
  const primary = primaryFlagReason(codes)
  return primary ? FLAG_DECISION_COPY[primary] : NEUTRAL_COPY
}

export function flagReasonTitle(codes: readonly string[]): string {
  const primary = primaryFlagReason(codes)
  return primary ? FLAG_REASON_LABELS[primary] : "Carga por decidir"
}

/** Todos los motivos en una frase («A · B»); el principal va primero. */
export function flagReasonsLabel(codes: readonly string[]): string {
  const known = FLAG_REASON_PRIORITY.filter((reason) => codes.includes(reason))
  return known.length > 0 ? known.map((reason) => FLAG_REASON_LABELS[reason]).join(" · ") : "Carga por decidir"
}

/** Motivos de uso corriente para escribir la nota con un toque. */
export const DECISION_QUICK_NOTES = ["Confirmado con el operador", "Error de digitación", "Cambio de tablero", "Es la misma carga"] as const

const fmt = (value: number, digits = 1) => formatQty(value, undefined, { maximumFractionDigits: digits })

export interface FlagDatumInput {
  liters: number
  meterReading: number | null
  meterType: "odometer" | "hour_meter" | null
  performanceValue: number | null
  performanceUnit: PerformanceUnit | null
  capacity: number | null
  /** Lectura anterior válida del equipo (para «lectura menor a la anterior»). */
  previousReading: number | null
  /** La carga de la que ésta sería duplicada. */
  original: { liters: number; occurredAt: string; originLabel: string } | null
  occurredAt: string
  originLabel: string
  /** Código o patente tal como llegó en el origen, para «sin ficha». */
  rawEquipment: string | null
  /** Cuándo se anotó en la plataforma (para «registrada después»). */
  registeredAt: string
  /** Lo normal para el equipo: media ± k desviaciones de sus cargas válidas. */
  range: { low: number; high: number } | null
}

const meterUnit = (type: FlagDatumInput["meterType"]) => (type === "hour_meter" ? "h" : "km")

/** El dato que explica el motivo principal: «182.310 km; la carga anterior marcó 182.900 km». */
export function flagDatum(codes: readonly string[], input: FlagDatumInput): string {
  const primary = primaryFlagReason(codes)
  const unit = meterUnit(input.meterType)
  switch (primary) {
    case "meter_regression":
      if (input.meterReading === null) return "La lectura es menor a la anterior"
      return input.previousReading === null
        ? `${fmt(input.meterReading)} ${unit}; es menor a la lectura anterior`
        : `${fmt(input.meterReading)} ${unit}; la carga anterior marcó ${fmt(input.previousReading)} ${unit}`
    case "duplicate":
      return input.original
        ? `${input.originLabel} a las ${formatDateTime(input.occurredAt).slice(-5)} y ${input.original.originLabel.toLowerCase()} a las ${formatDateTime(input.original.occurredAt).slice(-5)}, de ${fmt(input.liters)} y ${fmt(input.original.liters)} L`
        : `${fmt(input.liters)} L registrados dos veces en pocos minutos`
    case "over_capacity":
      return input.capacity !== null
        ? `${fmt(input.liters)} L en un estanque de ${fmt(input.capacity)} L`
        : `${fmt(input.liters)} L, más de lo que cabe en el estanque`
    case "unknown_vehicle":
      return input.rawEquipment
        ? `El origen trae el código ${input.rawEquipment}, que no está en el catálogo`
        : "El origen no trae un equipo que esté en el catálogo"
    case "late_entry":
      return `Cargada el ${formatDateTime(input.occurredAt)}; anotada el ${formatDateTime(input.registeredAt)}`
    case "filler_value":
      return "La fecha o el sello parecen inventados (valor de relleno)"
    case "implausible":
    case "outlier": {
      if (input.performanceValue === null || !input.performanceUnit) return `${fmt(input.liters)} L`
      const unitLabel = PERFORMANCE_UNIT_LABELS[input.performanceUnit]
      const value = `${fmt(input.performanceValue, 2)} ${unitLabel}`
      return primary === "outlier" && input.range
        ? `${value}; lo normal para este equipo es entre ${fmt(input.range.low, 2)} y ${fmt(input.range.high, 2)} ${unitLabel}`
        : value
    }
    default:
      return `${fmt(input.liters)} L`
  }
}

/** Nota obligatoria de toda decisión sobre una carga: el servidor aplica el mismo mínimo y máximo. */
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

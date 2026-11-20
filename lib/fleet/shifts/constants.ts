/**
 * Valores de «Turnos y ralentí» fijados en el diseño
 * (`docs/superpowers/specs/2026-11-20-turnos-ralenti-design.md`).
 */

/** Meta de ralentí por defecto (fracción): la de la página original «Ralentí Cholguán». */
export const IDLE_TARGET_DEFAULT = 0.30

/** Un turno con menos horas de motor que esto es «Sin uso» y no entra al ranking. */
export const MIN_ENGINE_HOURS = 0.5

/** Desde cuántas horas de motor sin turno se avisa en el equipo-día. */
export const UNASSIGNED_WARNING_HOURS = 1

/** Margen sobre el fin de una hora para darla por conocida (latencia medida: ~15 min). */
export const KNOWN_HOUR_MARGIN_MS = 3_600_000

/** Días que reescribe la corrida de las 06:00. */
export const DAILY_LOOKBACK_DAYS = 14

/** Días (ayer y hoy) que reescribe la corrida liviana de cada hora. */
export const HOURLY_LOOKBACK_DAYS = 2

/** Marca con que se consultan los tramos (`makeSerialNumbers=CAT|<serie>`): toda la flota VisionLink es Cat. */
export const VISIONLINK_MAKE = "CAT"

/** La API de tramos acepta hasta un mes por consulta. */
export const SEGMENT_WINDOW_DAYS = 28

/** Fuente de las filas por hora que trae la API (la misma que el resumen diario). */
export const HOURLY_SOURCE = "visionlink-api"

/** Turnos predefinidos del formulario, en este orden. «Otro horario» no tiene horas. */
export const SHIFT_PRESETS = [
  { label: "Mañana 06–14", startHour: 6, endHour: 14 },
  { label: "Tarde 14–22", startHour: 14, endHour: 22 },
  { label: "Noche 22–06", startHour: 22, endHour: 6 },
  { label: "Día 12 h 06–18", startHour: 6, endHour: 18 },
  { label: "Noche 12 h 18–06", startHour: 18, endHour: 6 },
] as const

export const OTHER_SHIFT_LABEL = "Otro horario"

/** Rótulo del turno predefinido con esas horas, o `null` si es «Otro horario». */
export function shiftPresetLabel(startHour: number, endHour: number): string | null {
  return SHIFT_PRESETS.find((preset) => preset.startHour === startHour && preset.endHour === endHour)?.label ?? null
}

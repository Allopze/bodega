/**
 * Tipos del dominio de mantención de equipos, compartidos por la app del
 * mecánico (navegador, sin conexión) y el servidor. Este archivo y sus vecinos
 * de `lib/mantencion/` son puros: sin `@/db`, sin `next/*`, sin Node.
 */

export type MantUnit = "km" | "h"
export type MantRecordKind = "P" | "C"
export type MantItemValue = "R" | "NR" | "NA"
export type MantBrandRuleValue = "A" | "W" | "X"
export type MantRecordStatus = "vigente" | "anulado"
export type MantReview = "pendiente" | "observado" | "revisado"
export type MantExecutorKind = "yo" | "otro_mecanico" | "externo"
export type MantPhotoKind = "filtros" | "sticker" | "correctiva"
export type MantWorkshopUpdateKind = "sigue" | "salio"

/** Estado de mantención de un equipo (regla 6), en el orden en que se listan. */
export const MANT_EQUIPMENT_STATES = ["vencida", "proxima", "al_dia", "sin_lecturas", "sin_pauta", "baja"] as const
export type MantEquipmentState = (typeof MANT_EQUIPMENT_STATES)[number]

/**
 * Foto de una versión de pauta, tal como la recibe la app y como queda en
 * `mant_schedule_versions.snapshot`. `intervals` son los activos, ordenados de
 * menor a mayor; `applies[i]` corresponde a `intervals[i]`.
 */
export interface MantScheduleSnapshot {
  id: string
  name: string
  unit: MantUnit
  version: number
  intervals: number[]
  groups: Array<{
    name: string
    items: Array<{ key: string; name: string; applies: boolean[] }>
  }>
  /** Sólo las reglas con ítem asociado; las filas de planilla sin ítem no afectan la app. */
  brandRules: Array<{ itemKey: string; brandId: string; value: MantBrandRuleValue }>
}

/** Una lectura vigente del equipo: de un registro o la lectura inicial de su ficha. */
export interface MantReading {
  value: number
  /** `YYYY-MM-DD` */
  date: string
  /** Folio o «Lectura inicial», para los mensajes. */
  source: string
}

/** Ítem de pauta que el mecánico debe marcar (regla 5). */
export interface MantChecklistItem {
  key: string
  name: string
  group: string
  /** W: «Confirmar con pauta del fabricante». */
  manufacturerWarning: boolean
}

export interface MantSuggestion {
  /** Índice en `intervals`. */
  index: number
  intervalValue: number
  /** La lectura redondeada al intervalo base. */
  point: number
}

export interface MantEquipmentStatus {
  state: MantEquipmentState
  currentReading: MantReading | null
  /** Lectura en que toca la próxima preventiva. */
  nextReading: number | null
  /** `nextReading − lectura actual`; ≤ 0 es vencida. */
  remaining: number | null
  /** Intervalo de la pauta que toca en `nextReading`. */
  nextIntervalValue: number | null
  lastPreventive: { reading: number; date: string; intervalValue: number } | null
}

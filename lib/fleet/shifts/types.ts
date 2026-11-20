/** Fecha civil `YYYY-MM-DD` (como se guardan las fechas sin hora). */
export type PlainDate = string

/** Un turno: de `startHour` a `endHour` (horas enteras); si `endHour <= startHour`, termina al día siguiente. */
export interface ShiftWindow {
  shiftDate: PlainDate
  startHour: number
  endHour: number
}

/** Una hora de reloj en Chile continental (`America/Santiago`). */
export interface HourKey {
  day: PlainDate
  hour: number
}

/** Tipos de tramo de VisionLink que se suman; otro tipo se registra y se descarta. */
export type SegmentType = "idle" | "working" | "running"

/** Lo que se registra de un turno (formulario, acciones e importación). */
export interface ShiftInput {
  vehicleId: string
  /** Fecha en que empieza el turno. */
  shiftDate: PlainDate
  startHour: number
  endHour: number
  operatorWorkerId: string
  notes: string
}

/** Segundos de motor de una hora por tipo de tramo. */
export interface HourSeconds {
  idle: number
  working: number
  running: number
}

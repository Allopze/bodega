import type { MantEquipmentStatus, MantUnit } from "./types"

/**
 * Formatos del módulo (§14): miles con punto, decimales con coma, unidades
 * siempre visibles. Las fechas usan `formatDate` / `formatDateTime` de
 * `@/lib/utils` (dd-mm-aaaa); aquí sólo lo propio de lecturas y horas.
 */

const INTEGER = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 })
const ONE_DECIMAL = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 1 })

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? INTEGER.format(value) : ONE_DECIMAL.format(value)
}

/** `40.312 km`, `5.400 h`. */
export function formatReading(value: number, unit: MantUnit): string {
  return `${formatNumber(value)} ${unit}`
}

export function unitName(unit: MantUnit): string {
  return unit === "km" ? "kilómetros" : "horas"
}

export function meterName(unit: MantUnit): string {
  return unit === "km" ? "odómetro" : "horómetro"
}

/** `1,5 h`, `1 h`. */
export function formatHours(hours: number): string {
  return `${ONE_DECIMAL.format(hours)} h`
}

/**
 * Lectura escrita con separador de miles mientras se tipea: deja sólo dígitos y
 * devuelve el número y su forma formateada. «40312» → `{ value: 40312, text: "40.312" }`.
 */
export function parseReadingInput(raw: string): { value: number | null; text: string } {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 9)
  if (!digits) return { value: null, text: "" }
  const value = Number(digits)
  return { value, text: INTEGER.format(value) }
}

/** «faltan 141 km» / «pasada por 312 km». */
export function remainingText(status: Pick<MantEquipmentStatus, "remaining">, unit: MantUnit): string {
  if (status.remaining == null) return ""
  if (status.remaining === 0) return "ya corresponde"
  return status.remaining < 0
    ? `pasada por ${formatReading(-status.remaining, unit)}`
    : `faltan ${formatReading(status.remaining, unit)}`
}

/** «Toca la de 40.000 km · faltan 141 km». */
export function dueText(status: Pick<MantEquipmentStatus, "remaining" | "nextIntervalValue">, unit: MantUnit): string {
  if (status.nextIntervalValue == null) return ""
  return `Toca la de ${formatReading(status.nextIntervalValue, unit)} · ${remainingText(status, unit)}`
}

export const EQUIPMENT_STATE_LABEL = {
  vencida: "Vencida",
  proxima: "Próxima",
  al_dia: "Al día",
  sin_lecturas: "Sin lecturas",
  sin_pauta: "Sin pauta",
  baja: "Dado de baja",
} as const

export const ITEM_VALUE_LABEL = { R: "Realizado", NR: "No realizado", NA: "No aplica" } as const

export const REVIEW_LABEL = { pendiente: "Pendiente", observado: "Observado", revisado: "Revisado" } as const

export const RECORD_STATUS_LABEL = { vigente: "Vigente", anulado: "Anulado" } as const

export const PHOTO_KIND_LABEL = {
  filtros: "Filtros usados",
  sticker: "Sticker de mantención",
  correctiva: "Foto del trabajo",
} as const

export function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`
}

/** «Preventiva 40.000 km» / «Correctiva». */
export function recordKindText(kind: "P" | "C", intervalValue: number | null, unit: MantUnit): string {
  return kind === "P" && intervalValue != null ? `Preventiva ${formatReading(intervalValue, unit)}` : kind === "P" ? "Preventiva" : "Correctiva"
}

/** Regla 10: «Registrado por X en nombre de Y» cuando quien ejecutó no es quien registró. */
export function executorText(input: {
  executorKind: "yo" | "otro_mecanico" | "externo"
  registeredByName: string
  executorName: string
}): string {
  if (input.executorKind === "yo") return input.registeredByName
  if (input.executorKind === "externo") return `${input.executorName} (taller externo) · registrado por ${input.registeredByName}`
  return `Registrado por ${input.registeredByName} en nombre de ${input.executorName}`
}

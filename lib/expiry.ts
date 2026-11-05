/**
 * Estado de un vencimiento: una sola lógica para flota, licencias y mantención.
 *
 * Antes cada pantalla decidía por su cuenta qué era «por vencer» (mantención con
 * 30 días fijos, flota con el ajuste `fleet.document.warning_days`) y redactaba
 * a su modo el «vence en N días». Las fechas son civiles (`YYYY-MM-DD`) y `today`
 * lo pasa el llamador con `todayInChile()`: la función queda pura y no le
 * pregunta a UTC qué día es hoy.
 */

import { formatDate, pluralize } from "@/lib/utils"

export type ExpiryState = "vigente" | "por_vencer" | "vencido" | "sin_fecha"

export interface ExpiryStatus {
  state: ExpiryState
  /** Días desde `today` hasta la fecha: negativo si ya venció; null sin fecha. */
  days: number | null
  expiresAt: string | null
}

/** Días civiles entre dos fechas `YYYY-MM-DD` (b − a), sin que lo mueva el cambio de hora. */
export function civilDaysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/**
 * Vence hoy cuenta como vigente-por-vencer (todavía sirve hoy): `vencido` es
 * estrictamente anterior a hoy, igual que `/flota?vencimiento=vencidos`.
 */
export function expiryState(expiresAt: string | null | undefined, today: string, warningDays: number): ExpiryStatus {
  if (!expiresAt) return { state: "sin_fecha", days: null, expiresAt: null }
  const days = civilDaysBetween(today, expiresAt)
  if (days < 0) return { state: "vencido", days, expiresAt }
  return { state: days <= warningDays ? "por_vencer" : "vigente", days, expiresAt }
}

const dias = (n: number) => `${n} ${pluralize(n, "día")}`

/**
 * Frase relativa, en minúscula inicial para poder componerla («Rev. técnica ·
 * vence en 9 días»). Más allá de la ventana de aviso no cuenta días —«vence el
 * 30-09-2027» se lee mejor que «vence en 329 días»—.
 */
export function expiryRelativeText(status: ExpiryStatus, warningDays: number): string | null {
  const { days, expiresAt } = status
  if (days == null || !expiresAt) return null
  if (days === 0) return "vence hoy"
  if (days === 1) return "vence mañana"
  if (days < 0) return `venció hace ${dias(-days)}`
  if (days <= warningDays) return `vence en ${dias(days)}`
  return `vence el ${formatDate(expiresAt)}`
}

export const EXPIRY_STATE_LABEL: Record<ExpiryState, string> = {
  vigente: "Vigente",
  por_vencer: "Por vencer",
  vencido: "Vencido",
  sin_fecha: "Sin fecha",
}

export const EXPIRY_STATE_VARIANT: Record<ExpiryState, "success" | "warning" | "danger" | "neutral"> = {
  vigente: "success",
  por_vencer: "warning",
  vencido: "danger",
  sin_fecha: "neutral",
}

/** Orden de urgencia: lo vencido más antiguo primero, después lo más próximo, al final lo sin fecha. */
export function compareExpiryUrgency(a: ExpiryStatus, b: ExpiryStatus): number {
  if (a.days == null && b.days == null) return 0
  if (a.days == null) return 1
  if (b.days == null) return -1
  return a.days - b.days
}

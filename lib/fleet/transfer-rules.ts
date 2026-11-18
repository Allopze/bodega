import { addDaysToPlainDate, formatDate } from "@/lib/utils"

/** Tope de equipos en un mismo traslado. */
export const MAX_VEHICLES_PER_TRANSFER = 100

const MIN_REASON_LENGTH = 10
const MIN_AUTHORIZED_BY_LENGTH = 3

/**
 * Una fecha civil `YYYY-MM-DD` es válida si el calendario la reconoce tal cual
 * (rechaza «2026-13-01» y «2026-02-30», que `Date.UTC` desbordaría al mes siguiente).
 */
function isValidPlainDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return false
  const [, y, m, d] = match
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).toISOString().slice(0, 10) === date
}

/**
 * Ventana de fechas de un traslado por pantalla: desde el día 1 del mes anterior
 * hasta hoy. `today` es el día civil chileno (`todayInChile()`).
 */
export function transferDateWindow(today: string): { min: string; max: string } {
  const firstOfThisMonth = `${today.slice(0, 7)}-01`
  const lastOfPreviousMonth = addDaysToPlainDate(firstOfThisMonth, -1)
  return { min: `${lastOfPreviousMonth.slice(0, 7)}-01`, max: today }
}

/**
 * Mensaje de error para la fecha de un traslado, o `null` si sirve. Además de la
 * ventana, debe ser estrictamente posterior al inicio de la estadía actual del
 * equipo (`currentStayStartedOn`, `null` si no tiene).
 */
export function transferDateError(
  date: string,
  today: string,
  currentStayStartedOn: string | null,
): string | null {
  if (!isValidPlainDate(date)) return "La fecha no es válida."
  const { min, max } = transferDateWindow(today)
  if (date > max) return "La fecha no puede ser posterior a hoy."
  if (date < min) return `La fecha no puede ser anterior al ${formatDate(min)}.`
  if (currentStayStartedOn && date <= currentStayStartedOn) {
    return `Llegó a su faena actual el ${formatDate(currentStayStartedOn)}: la fecha debe ser posterior.`
  }
  return null
}

/** Errores por campo del motivo y de quién autorizó el traslado (textos recortados). */
export function transferTextErrors(input: {
  reason: string
  authorizedBy: string
}): Partial<Record<"reason" | "authorizedBy", string>> {
  const errors: Partial<Record<"reason" | "authorizedBy", string>> = {}
  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    errors.reason = `Explica el motivo en al menos ${MIN_REASON_LENGTH} caracteres.`
  }
  if (input.authorizedBy.trim().length < MIN_AUTHORIZED_BY_LENGTH) {
    errors.authorizedBy = "Indica quién lo autorizó."
  }
  return errors
}

/** Folio legible del traslado: `TR-0007`; pasa de cuatro dígitos sin truncar. */
export function formatTransferFolio(n: number): string {
  return `TR-${String(n).padStart(4, "0")}`
}

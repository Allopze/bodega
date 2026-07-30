type PdtpRetirementState = {
  status: string
  retiredEffectiveFrom: string | null
}

/**
 * Cada celda PDTP representa una semana convencional del libro: días
 * 1, 8, 15 y 22. El retiro rige para las celdas cuyo inicio cae en o
 * después de la fecha efectiva.
 */
export function pdtpPeriodStartDate(year: number, month: number, week: number): string {
  const day = 1 + (week - 1) * 7
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function isPdtpActivityEffectiveForPeriod(
  activity: PdtpRetirementState,
  year: number,
  month: number,
  week: number,
): boolean {
  if (activity.status !== "retired") return true
  if (!activity.retiredEffectiveFrom) return false
  return pdtpPeriodStartDate(year, month, week) < activity.retiredEffectiveFrom
}

export function isPdtpActivityEffectiveAt(
  activity: PdtpRetirementState,
  occurredAt: string,
): boolean {
  if (activity.status !== "retired") return true
  if (!activity.retiredEffectiveFrom) return false
  return occurredAt.slice(0, 10) < activity.retiredEffectiveFrom
}

/** Traslada una fecha de la revisión base al año destino, incluyendo 29/02. */
export function remapPdtpDateToYear(value: string | null, targetYear: number): string | null {
  if (!value) return null
  const [, monthText, dayText] = value.slice(0, 10).split("-")
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
  return `${String(targetYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`
}

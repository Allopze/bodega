export type PdtpRecurrenceFrequency = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual" | "custom"

export type PdtpRecurrenceRule = {
  frequency: PdtpRecurrenceFrequency
  interval: number
  plannedQuantity: number
  months?: number[]
  weekOfMonth: number
}

export type PdtpScheduleCell = { month: number; week: number; plannedQuantity: number }
export type PdtpScheduleMode = "scheduled" | "on_demand" | "triggered"

/**
 * Horizonte de proyección: qué meses calendario (1-12, dentro del año del
 * programa) y cuántas semanas por mes admite la grilla de compatibilidad.
 * `pdtpActivitySchedule` sigue acotado a un único año con semana 1-4 por
 * restricción de esquema (CHECK), así que multi-año o semanas ISO reales
 * quedan fuera de este horizonte — requieren remodelar esa tabla.
 */
export type PdtpScheduleHorizon = {
  months: number[]
  weeksPerMonth: number
}

const FULL_YEAR_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1)
export const DEFAULT_SCHEDULE_HORIZON: PdtpScheduleHorizon = { months: FULL_YEAR_MONTHS, weeksPerMonth: 4 }

/**
 * Deriva el horizonte real de un programa a partir de su período declarado.
 * Sin `periodStart`/`periodEnd` (el caso 2026 y la mayoría de programas
 * hoy), el horizonte es el año calendario completo — comportamiento
 * idéntico al anterior. Con un período parcial (ej. un contrato de 6
 * meses), solo se proyectan los meses que ese período cubre dentro del
 * año del programa, evitando fabricar obligaciones fuera de su alcance.
 */
export function deriveScheduleHorizon(
  program: { year: number; periodStart?: string | null; periodEnd?: string | null },
  weeksPerMonth = 4,
): PdtpScheduleHorizon {
  if (!program.periodStart || !program.periodEnd) return { months: FULL_YEAR_MONTHS, weeksPerMonth }
  const start = new Date(program.periodStart)
  const end = new Date(program.periodEnd)
  const months = FULL_YEAR_MONTHS.filter((month) => {
    const monthStart = new Date(Date.UTC(program.year, month - 1, 1))
    const monthEnd = new Date(Date.UTC(program.year, month, 0))
    return monthEnd >= start && monthStart <= end
  })
  return { months: months.length > 0 ? months : FULL_YEAR_MONTHS, weeksPerMonth }
}

const FREQUENCY_LABELS: Record<PdtpRecurrenceFrequency, string> = {
  weekly: "semanal",
  monthly: "mensual",
  quarterly: "trimestral",
  semiannual: "semestral",
  annual: "anual",
  custom: "en meses seleccionados",
}

/**
 * Proyección de compatibilidad hacia la grilla histórica de semanas/mes.
 * La regla de recurrencia es la fuente de verdad del constructor; estas celdas
 * permiten que las vistas operacionales antiguas sigan funcionando durante la
 * transición y no convierten las 48 columnas del Excel en el modelo de autoría.
 * `horizon` acota a qué meses/semanas del año del programa se proyecta —
 * por defecto, el año calendario completo (comportamiento histórico).
 */
export function projectRecurrenceToLegacySchedule(
  rule: PdtpRecurrenceRule,
  horizon: PdtpScheduleHorizon = DEFAULT_SCHEDULE_HORIZON,
): PdtpScheduleCell[] {
  const interval = Math.max(1, Math.trunc(rule.interval || 1))
  const quantity = Math.max(0, rule.plannedQuantity)
  const weeksPerMonth = Math.min(4, Math.max(1, Math.trunc(horizon.weeksPerMonth || 4)))
  const week = Math.min(weeksPerMonth, Math.max(1, Math.trunc(rule.weekOfMonth || 1)))
  const months = [...new Set(horizon.months)].filter((month) => month >= 1 && month <= 12).sort((a, b) => a - b)

  if (rule.frequency === "weekly") {
    const cells: PdtpScheduleCell[] = []
    let position = 0
    for (const month of months) {
      for (let weekOfMonth = 1; weekOfMonth <= weeksPerMonth; weekOfMonth++) {
        if (position % interval === 0) cells.push({ month, week: weekOfMonth, plannedQuantity: quantity })
        position += 1
      }
    }
    return cells
  }

  const monthStep = rule.frequency === "monthly"
    ? interval
    : rule.frequency === "quarterly"
      ? 3 * interval
      : rule.frequency === "semiannual"
        ? 6 * interval
        : 12 * interval
  const candidateMonths = rule.frequency === "custom"
    ? [...new Set(rule.months ?? [])].filter((month) => month >= 1 && month <= 12)
    : FULL_YEAR_MONTHS.filter((month) => (month - 1) % monthStep === 0)
  const selectedMonths = candidateMonths.filter((month) => months.includes(month)).sort((a, b) => a - b)

  return selectedMonths.map((month) => ({ month, week, plannedQuantity: quantity }))
}

export function describePdtpRecurrence(rule: PdtpRecurrenceRule, horizon: PdtpScheduleHorizon = DEFAULT_SCHEDULE_HORIZON): string {
  const base = FREQUENCY_LABELS[rule.frequency]
  const interval = rule.interval > 1 ? ` cada ${rule.interval} ciclos` : ""
  const quantity = rule.plannedQuantity === 1 ? "1 ejecución" : `${rule.plannedQuantity} ejecuciones`
  const projected = projectRecurrenceToLegacySchedule(rule, horizon)
  const periodLabel = horizon.months.length >= 12 ? "período anual" : `período de ${horizon.months.length} mes(es)`
  return `${quantity}, frecuencia ${base}${interval}. Genera ${projected.length} obligación(es) en el ${periodLabel}.`
}

export function describePdtpRecurrenceImpact(
  currentMode: PdtpScheduleMode,
  currentRule: PdtpRecurrenceRule | null,
  nextMode: PdtpScheduleMode,
  nextRule: PdtpRecurrenceRule | null,
  horizon: PdtpScheduleHorizon = DEFAULT_SCHEDULE_HORIZON,
) {
  const currentCount = currentMode === "scheduled" && currentRule ? projectRecurrenceToLegacySchedule(currentRule, horizon).length : 0
  const nextCount = nextMode === "scheduled" && nextRule ? projectRecurrenceToLegacySchedule(nextRule, horizon).length : 0
  const changed = currentMode !== nextMode || JSON.stringify(currentRule) !== JSON.stringify(nextRule)
  return { currentCount, nextCount, changed }
}

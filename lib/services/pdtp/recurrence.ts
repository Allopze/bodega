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

const FREQUENCY_LABELS: Record<PdtpRecurrenceFrequency, string> = {
  weekly: "semanal",
  monthly: "mensual",
  quarterly: "trimestral",
  semiannual: "semestral",
  annual: "anual",
  custom: "en meses seleccionados",
}

/**
 * Proyección de compatibilidad hacia la grilla histórica de 4 semanas/mes.
 * La regla de recurrencia es la fuente de verdad del constructor; estas celdas
 * permiten que las vistas operacionales antiguas sigan funcionando durante la
 * transición y no convierten las 48 columnas del XLSX en el modelo de autoría.
 */
export function projectRecurrenceToLegacySchedule(rule: PdtpRecurrenceRule): PdtpScheduleCell[] {
  const interval = Math.max(1, Math.trunc(rule.interval || 1))
  const quantity = Math.max(0, rule.plannedQuantity)
  const week = Math.min(4, Math.max(1, Math.trunc(rule.weekOfMonth || 1)))

  if (rule.frequency === "weekly") {
    const cells: PdtpScheduleCell[] = []
    let position = 0
    for (let month = 1; month <= 12; month++) {
      for (let weekOfMonth = 1; weekOfMonth <= 4; weekOfMonth++) {
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
  const months = rule.frequency === "custom"
    ? [...new Set(rule.months ?? [])].filter((month) => month >= 1 && month <= 12).sort((a, b) => a - b)
    : Array.from({ length: 12 }, (_, index) => index + 1).filter((month) => (month - 1) % monthStep === 0)

  return months.map((month) => ({ month, week, plannedQuantity: quantity }))
}

export function describePdtpRecurrence(rule: PdtpRecurrenceRule): string {
  const base = FREQUENCY_LABELS[rule.frequency]
  const interval = rule.interval > 1 ? ` cada ${rule.interval} ciclos` : ""
  const quantity = rule.plannedQuantity === 1 ? "1 ejecución" : `${rule.plannedQuantity} ejecuciones`
  const projected = projectRecurrenceToLegacySchedule(rule)
  return `${quantity}, frecuencia ${base}${interval}. Genera ${projected.length} obligación(es) en el período anual.`
}

export function describePdtpRecurrenceImpact(
  currentMode: PdtpScheduleMode,
  currentRule: PdtpRecurrenceRule | null,
  nextMode: PdtpScheduleMode,
  nextRule: PdtpRecurrenceRule | null,
) {
  const currentCount = currentMode === "scheduled" && currentRule ? projectRecurrenceToLegacySchedule(currentRule).length : 0
  const nextCount = nextMode === "scheduled" && nextRule ? projectRecurrenceToLegacySchedule(nextRule).length : 0
  const changed = currentMode !== nextMode || JSON.stringify(currentRule) !== JSON.stringify(nextRule)
  return { currentCount, nextCount, changed }
}

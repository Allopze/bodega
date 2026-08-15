import { MONTH_LABELS } from "@/lib/services/pdtp/constants"

/* Programa de trabajo del Comité Paritario.
 *
 * Decisión D5 (2026-08-12): las actividades *del* comité salieron del programa
 * anual PDTP porque el CPHS mide su propio cumplimiento. Este módulo es esa
 * medición, y a propósito NO replica el motor del PDTP: la ocurrencia se deriva
 * del mes planificado contra la fecha de hoy, sin slots ni obligaciones
 * materializadas que mantener sincronizadas.
 */

export const COMMITTEE_PROGRAM_STATUS_LABELS: Record<string, string> = {
  draft: "En preparación",
  active: "Vigente",
  closed: "Cerrado",
}

export const PROGRAM_ACTIVITY_STATUS_LABELS: Record<string, string> = {
  planned: "Planificada",
  done: "Realizada",
  cancelled: "Cancelada",
}

/** Estado derivado: `overdue` no se guarda, se calcula contra la fecha. */
export const PROGRAM_ACTIVITY_DERIVED_LABELS: Record<string, string> = {
  pending: "Pendiente",
  done: "Realizada",
  overdue: "Atrasada",
  cancelled: "Cancelada",
}

/** Riesgos que el manual de Mutual pide relacionar con el programa. */
export const PROGRAM_RISK_TOPIC_LABELS: Record<string, string> = {
  vial: "Seguridad vial",
  higiene: "Higiene ocupacional",
  ergonomia: "Ergonomía",
  psicosocial: "Riesgos psicosociales",
  silice: "Sílice",
  otro: "Otro",
}

export type ProgramActivityDerivedStatus = "pending" | "done" | "overdue" | "cancelled"

export interface ProgramActivityRow {
  status: string
  plannedMonth: number
  dueOn: string | null
}

export function monthLabel(month: number): string {
  return MONTH_LABELS[month - 1] ?? `M${month}`
}

/** Último día del mes en `YYYY-MM-DD`. `month` es 1-12. */
export function monthDeadline(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

/**
 * El plazo de una actividad es su `dueOn` explícito o, a falta de él, el último
 * día del mes en que se planificó.
 */
export function activityDeadline(activity: ProgramActivityRow, programYear: number): string {
  return activity.dueOn ?? monthDeadline(programYear, activity.plannedMonth)
}

/**
 * Una actividad sólo se atrasa cuando su plazo ya pasó y sigue planificada.
 * Realizarla antes de su mes es válido y cuenta como realizada.
 */
export function deriveProgramActivityStatus(
  activity: ProgramActivityRow,
  programYear: number,
  asOf: string,
): ProgramActivityDerivedStatus {
  if (activity.status === "cancelled") return "cancelled"
  if (activity.status === "done") return "done"
  return activityDeadline(activity, programYear) < asOf ? "overdue" : "pending"
}

export interface ProgramComplianceSummary {
  /** Actividades vigentes del programa (excluye canceladas). */
  total: number
  /** Actividades cuyo plazo ya llegó: el denominador del cumplimiento. */
  due: number
  done: number
  overdue: number
  pending: number
  /** `null` mientras ninguna actividad sea exigible todavía. */
  compliancePct: number | null
}

/**
 * El denominador son las actividades exigibles a la fecha, no las 12 del año:
 * un programa recién aprobado en marzo no está "75% incumplido".
 */
export function summarizeProgramCompliance(
  activities: ProgramActivityRow[],
  programYear: number,
  asOf: string,
): ProgramComplianceSummary {
  const live = activities.filter((activity) => activity.status !== "cancelled")
  const done = live.filter((activity) => activity.status === "done").length
  const overdue = live.filter((activity) => deriveProgramActivityStatus(activity, programYear, asOf) === "overdue").length
  // Exigible = lo realizado más lo que venció sin realizarse. Una actividad
  // realizada antes de su mes cuenta: se cumplió el compromiso.
  const due = done + overdue

  return {
    total: live.length,
    due,
    done,
    overdue,
    pending: live.length - done - overdue,
    compliancePct: due === 0 ? null : Math.round((done / due) * 100),
  }
}

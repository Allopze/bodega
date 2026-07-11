/**
 * Labels canónicos de urgencia/severidad.
 *
 * Convención: masculino genérico ("Crítico") en singular sin contexto.
 * "Crítica" se reservó históricamente a campos cuyo sustantivo es femenino
 * (solicitud), pero genera inconsistencia cuando el mismo valor se aplica
 * a "ítem" o "estado" (masculinos). El adjetivo masculino es seguro
 * para todos los usos del sistema.
 *
 * Esta es la única fuente de verdad. Reemplaza los maps locales en
 * solicitudes/request-list.tsx, solicitudes/request-form.constants.ts,
 * aprobaciones/types.ts, dashboard/dashboard-task-row.tsx y
 * reports/export-module/labels.ts.
 */
export const URGENCY_LABELS = {
  normal:   "Normal",
  high:     "Alta",
  critical: "Crítico",
} as const

export type Urgency = keyof typeof URGENCY_LABELS

export function urgencyLabel(urgency: string | null | undefined): string {
  if (!urgency) return "—"
  return URGENCY_LABELS[urgency as Urgency] ?? urgency
}

/** Lista de opciones para selects. Mismo orden en todos los formularios. */
export const URGENCY_OPTIONS: ReadonlyArray<{ value: Urgency; label: string }> =
  (Object.entries(URGENCY_LABELS) as [Urgency, string][]).map(([value, label]) => ({ value, label }))

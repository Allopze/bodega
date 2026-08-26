export const EMERGENCY_PLAN_STATUS_LABELS: Record<string, string> = {
  draft: "En preparación",
  approved: "Aprobado",
  archived: "Archivado",
}

export const EMERGENCY_SCENARIO_TYPE_LABELS: Record<string, string> = {
  incendio: "Incendio",
  derrame: "Derrame",
  fuga: "Fuga",
  volcamiento: "Volcamiento",
  exposicion: "Exposición",
  rescate: "Rescate",
  sismo: "Sismo",
  clima: "Evento climático",
  otro: "Otro",
}

export const EMERGENCY_RESOURCE_STATUS_LABELS: Record<string, string> = {
  operational: "Operativo",
  needs_maintenance: "Requiere mantención",
  out_of_service: "Fuera de servicio",
}

export function emergencyResourceStatusVariant(status: string): "success" | "warning" | "danger" {
  if (status === "operational") return "success"
  if (status === "out_of_service") return "danger"
  return "warning"
}

export const EMERGENCY_DRILL_STATUS_LABELS: Record<string, string> = {
  scheduled: "Programado",
  completed: "Realizado",
  cancelled: "Cancelado",
}

export const EMERGENCY_DRILL_OUTCOME_LABELS: Record<string, string> = {
  satisfactory: "Satisfactorio",
  needs_improvement: "Requiere mejora",
}

export function emergencyPlanStatusBadgeVariant(status: string): "success" | "warning" | "outline" {
  if (status === "approved") return "success"
  if (status === "draft") return "warning"
  return "outline"
}

export interface PlanReadinessInput {
  scenarios: { id: string }[]
  roles: { id: string }[]
}

export interface PlanReadinessResult {
  ready: boolean
  blockers: string[]
}

/**
 * Un plan de emergencia sin escenarios ni organigrama no es un plan operable,
 * es un documento en blanco: aprobar exige ambos. La cantidad exacta de
 * escenarios y roles depende de la faena y la define Prevención; el software
 * sólo sostiene que exista al menos uno de cada uno.
 */
export function assessPlanReadiness(input: PlanReadinessInput): PlanReadinessResult {
  const blockers: string[] = []
  if (input.scenarios.length === 0) {
    blockers.push("El plan no declara ningún escenario de emergencia.")
  }
  if (input.roles.length === 0) {
    blockers.push("El plan no declara ningún rol del organigrama de emergencia.")
  }
  return { ready: blockers.length === 0, blockers }
}

export interface DrillCompletionInput {
  participants: { present: boolean }[]
  evacuationSeconds: number | null
  outcome: "satisfactory" | "needs_improvement" | null
}

export interface DrillCompletionResult {
  ready: boolean
  blockers: string[]
}

/**
 * Completar un simulacro exige participantes registrados y un resultado
 * explícito: un simulacro "completado" sin nadie presente ni conclusión no
 * deja aprendizaje verificable, que es justamente lo que el DS 44 pide.
 */
export function assessDrillCompletion(input: DrillCompletionInput): DrillCompletionResult {
  const blockers: string[] = []
  if (input.participants.filter((item) => item.present).length === 0) {
    blockers.push("El simulacro no registra ningún participante presente.")
  }
  if (!input.outcome) {
    blockers.push("El simulacro no declara un resultado (satisfactorio o requiere mejora).")
  }
  return { ready: blockers.length === 0, blockers }
}

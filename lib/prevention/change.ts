export const CHANGE_TYPE_LABELS: Record<string, string> = {
  proceso: "Proceso o método",
  instalacion: "Instalación o layout",
  equipo: "Equipo o vehículo",
  sustancia: "Sustancia o residuo",
  proveedor: "Proveedor o contratista",
  requisito_legal: "Requisito legal",
  dotacion: "Dotación o jornada",
  software: "Software o automatización crítica",
  procedimiento: "Procedimiento",
  mandante: "Condición del cliente o mandante",
}

export const CHANGE_STATUS_LABELS: Record<string, string> = {
  draft: "En preparación",
  under_evaluation: "En evaluación",
  approved: "Aprobado",
  rejected: "Rechazado",
  implemented: "Implementado",
  closed: "Cerrado",
}

export const CHANGE_RISK_LEVEL_LABELS: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  critical: "Crítico",
}

export const CHANGE_DIMENSIONS = ["risk", "permit", "training", "document", "miper", "emergency"] as const
export type ChangeDimension = typeof CHANGE_DIMENSIONS[number]

export const CHANGE_DIMENSION_LABELS: Record<ChangeDimension, string> = {
  risk: "Riesgos (MIPER)",
  permit: "Permisos de trabajo",
  training: "Capacitación",
  document: "Documentos",
  miper: "Mapa de riesgos",
  emergency: "Plan de emergencia",
}

export function changeStatusBadgeVariant(status: string): "success" | "warning" | "danger" | "outline" | "default" {
  if (status === "approved" || status === "implemented" || status === "closed") return "success"
  if (status === "rejected") return "danger"
  if (status === "under_evaluation") return "warning"
  return "default"
}

export interface ChangeAssessmentRow {
  dimension: string
  evaluated: boolean
}

export interface ChangeReadinessResult {
  ready: boolean
  blockers: string[]
}

/**
 * Un cambio no pasa a aprobado hasta que las seis dimensiones de impacto
 * estén evaluadas y exista una fecha de revisión posterior: sin eso queda
 * sin trazabilidad de qué se evaluó y cuándo se revisa si la evaluación
 * siguió siendo válida — el mismo defecto que "cerrar sin conclusiones" en
 * la revisión por la dirección de CPHS.
 */
export function assessChangeReadiness(input: {
  assessments: ChangeAssessmentRow[]
  plannedReviewDate: string | null
}): ChangeReadinessResult {
  const blockers: string[] = []
  const evaluated = new Set(input.assessments.filter((row) => row.evaluated).map((row) => row.dimension))
  const missing = CHANGE_DIMENSIONS.filter((dimension) => !evaluated.has(dimension))
  if (missing.length > 0) {
    blockers.push(`Faltan por evaluar: ${missing.map((d) => CHANGE_DIMENSION_LABELS[d]).join(", ")}.`)
  }
  if (!input.plannedReviewDate) {
    blockers.push("El cambio no declara una fecha de revisión posterior.")
  }
  return { ready: blockers.length === 0, blockers }
}

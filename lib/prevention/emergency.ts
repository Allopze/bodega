export const EMERGENCY_PLAN_STATUS_LABELS: Record<string, string> = {
  draft: "En preparación",
  approved: "Aprobado",
  archived: "Archivado",
}

/**
 * Los escenarios que un plan de emergencia puede declarar.
 *
 * Dos vocabularios en una sola lista, y a propósito:
 *
 * - Las **quince primeras** son las amenazas del protocolo de respuesta que la
 *   empresa ya usa (`DO-41`, hoja `Plan_Respuesta`), que a su vez sigue el
 *   catálogo de SENAPRED. Cinco de ellas son obligatorias para todo centro de
 *   trabajo y tres se declaran sólo si el Visor Territorial las detecta; esa
 *   distinción vive en `EMERGENCY_THREAT_CATALOG`.
 * - Las **cinco últimas** son escenarios operacionales de una faena de residuos
 *   industriales. No son amenazas territoriales, pero tienen procedimiento
 *   propio (DO-28 control de derrames, DO-16 transporte RESPEL) y un plan que no
 *   pudiera declararlos sería más pobre que el papel.
 *
 * Salieron `incendio` —el protocolo lo parte en estructural y forestal—, `clima`
 * —lo cubren nevada, marejada e inundación— y `otro`, renombrado
 * `otra_amenaza` para que se lea como lo que es.
 *
 * La lista conserva los tipos base y sus códigos estables para las reglas de
 * amenazas territoriales, sembrado inicial y compatibilidad histórica. Los
 * selectores de la aplicación leen el catálogo administrable en base de datos.
 */
export const EMERGENCY_SCENARIO_TYPES = [
  "sismo",
  "tsunami",
  "aluvion",
  "incendio_estructural",
  "incendio_forestal",
  "asalto_robo",
  "erupcion_volcanica",
  "inundacion_lluvia",
  "inundacion_cauce",
  "nevada",
  "marejada",
  "corte_energia",
  "corte_agua",
  "desorden_publico",
  "otra_amenaza",
  "derrame",
  "fuga",
  "volcamiento",
  "exposicion",
  "rescate",
] as const

export type EmergencyScenarioType = (typeof EMERGENCY_SCENARIO_TYPES)[number]

export const EMERGENCY_SCENARIO_TYPE_LABELS: Record<EmergencyScenarioType, string> = {
  sismo: "Sismo",
  tsunami: "Tsunami o maremoto",
  aluvion: "Aluvión",
  incendio_estructural: "Incendio estructural",
  incendio_forestal: "Incendio forestal",
  asalto_robo: "Asalto o robo",
  erupcion_volcanica: "Erupción volcánica",
  inundacion_lluvia: "Inundación por lluvia",
  inundacion_cauce: "Inundación por crecida de cauce",
  nevada: "Nevada",
  marejada: "Marejada",
  corte_energia: "Corte de energía eléctrica",
  corte_agua: "Corte de agua potable",
  desorden_publico: "Desorden público",
  otra_amenaza: "Otra amenaza",
  derrame: "Derrame",
  fuga: "Fuga",
  volcamiento: "Volcamiento",
  exposicion: "Exposición",
  rescate: "Rescate",
}

/**
 * Etiqueta de un tipo de escenario que viene de la base.
 *
 * La columna es `text`, así que el valor leído es `string` y no el union: si
 * una fila trae algo que este catálogo no conoce —una migración a medio
 * aplicar, un valor retirado— se muestra el valor crudo en vez de `undefined`.
 * Un plan de emergencia que dice "sismo_raro" es feo; uno que dice "undefined"
 * es un error de la pantalla.
 */
export function emergencyScenarioTypeLabel(type: string): string {
  return EMERGENCY_SCENARIO_TYPE_LABELS[type as EmergencyScenarioType] ?? type
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
  activeEvidenceCount: number
  evacuationSeconds: number | null
  outcome: "satisfactory" | "needs_improvement" | null
}

export interface DrillCompletionResult {
  ready: boolean
  blockers: string[]
}

/**
 * Completar un simulacro exige evidencia y un resultado explícito: un simulacro
 * "completado" sin acta ni conclusión no deja aprendizaje verificable, que es
 * justamente lo que el DS 44 pide.
 *
 * El gate era «al menos un participante presente» hasta el 2026-09-19. Esa
 * lista se escribía y nadie la leía nunca, así que lo único que respaldaba el
 * hecho era un dato que ninguna consulta miraba. Ahora lo respalda el acta.
 */
export function assessDrillCompletion(input: DrillCompletionInput): DrillCompletionResult {
  const blockers: string[] = []
  if (input.activeEvidenceCount < 1) {
    blockers.push("El simulacro no tiene ninguna evidencia adjunta.")
  }
  if (!input.outcome) {
    blockers.push("El simulacro no declara un resultado (satisfactorio o requiere mejora).")
  }
  return { ready: blockers.length === 0, blockers }
}
